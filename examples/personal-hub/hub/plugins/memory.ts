import { HNSW } from "hnsw";
import { tool, z, type AgentPlugin, type AgentFileSystem } from "agent-hub";

type MemoryEntry = {
  content: string;
  extra?: Record<string, unknown>;
};

type StoredEntry = MemoryEntry & {
  embedding?: number[];
};

type IDZFile = {
  version: 1;
  name: string;
  description?: string;
  hasEmbeddings: boolean;
  entries: StoredEntry[];
};

function diskPath(name: string): string {
  return `/shared/memories/${name}.idz`;
}

async function fetchEmbeddings(
  texts: string[],
  vars: Record<string, unknown>
): Promise<number[][]> {
  const base = vars.EMBEDDING_API_BASE as string | undefined;
  const key = vars.EMBEDDING_API_KEY as string | undefined;
  const model = (vars.EMBEDDING_MODEL as string) || "text-embedding-3-small";

  if (!base || !key) {
    throw new Error(
      "Missing embedding config: set EMBEDDING_API_BASE and EMBEDDING_API_KEY in vars"
    );
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding API error: ${res.status} - ${errText}`);
  }

  const json = (await res.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return json.data.map((d) => d.embedding);
}

type DiskMeta = {
  name: string;
  description?: string;
  entryCount: number;
};

async function listDisks(fs: AgentFileSystem): Promise<DiskMeta[]> {
  const dir = await fs.readDir("/shared/memories");
  const disks: DiskMeta[] = [];

  for (const entry of dir) {
    if (entry.type === "file" && entry.path.endsWith(".idz")) {
      const content = await fs.readFile(entry.path);
      if (content) {
        try {
          const data = JSON.parse(content) as IDZFile;
          disks.push({
            name: data.name,
            description: data.description,
            entryCount: data.entries.length,
          });
        } catch {
          // Skip invalid files
        }
      }
    }
  }

  return disks;
}

async function loadDisk(
  fs: AgentFileSystem,
  name: string
): Promise<IDZFile | null> {
  const content = await fs.readFile(diskPath(name));
  if (!content) return null;
  return JSON.parse(content) as IDZFile;
}

async function saveDisk(fs: AgentFileSystem, disk: IDZFile): Promise<void> {
  await fs.writeFile(diskPath(disk.name), JSON.stringify(disk, null, 2));
}

async function searchDisk(
  fs: AgentFileSystem,
  vars: Record<string, unknown>,
  diskName: string,
  query: string,
  k: number = 5
): Promise<Array<MemoryEntry & { score: number }>> {
  const disk = await loadDisk(fs, diskName);
  if (!disk) {
    throw new Error(`Memory disk '${diskName}' not found`);
  }

  if (!disk.hasEmbeddings || disk.entries.length === 0) {
    // Fallback to simple text search if no embeddings
    const results: Array<MemoryEntry & { score: number }> = [];
    const queryLower = query.toLowerCase();
    for (const entry of disk.entries) {
      if (entry.content.toLowerCase().includes(queryLower)) {
        results.push({ content: entry.content, extra: entry.extra, score: 1 });
      }
    }
    return results.slice(0, k);
  }

  // Get query embedding
  const [queryEmbedding] = await fetchEmbeddings([query], vars);

  // Build HNSW index
  const dim = disk.entries[0].embedding!.length;
  const index = new HNSW(16, 200, dim);

  for (let i = 0; i < disk.entries.length; i++) {
    const entry = disk.entries[i];
    if (entry.embedding) {
      await index.addPoint(i, entry.embedding);
    }
  }

  // Search
  const results = index.searchKNN(queryEmbedding, k);

  return results.map((r: { id: number; score: number }) => {
    const entry = disk.entries[r.id];
    return {
      content: entry.content,
      extra: entry.extra,
      score: r.score,
    };
  });
}

async function addMemory(
  fs: AgentFileSystem,
  vars: Record<string, unknown>,
  diskName: string,
  content: string,
  extra?: Record<string, unknown>
): Promise<{ message: string }> {
  let disk = await loadDisk(fs, diskName);

  if (!disk) {
    disk = {
      version: 1,
      name: diskName,
      hasEmbeddings: false,
      entries: [],
    };
  }

  // Get embedding for the new content
  let embedding: number[] | undefined;
  try {
    const [emb] = await fetchEmbeddings([content], vars);
    embedding = emb;
    disk.hasEmbeddings = true;
  } catch {
    // Continue without embedding if it fails
  }

  disk.entries.push({
    content,
    extra,
    embedding,
  });

  await saveDisk(fs, disk);

  return {
    message: `Memory stored in '${diskName}'. Total entries: ${disk.entries.length}`,
  };
}

export const memory: AgentPlugin = {
  name: "memory",
  tags: [],

  varHints: [
    {
      name: "EMBEDDING_API_BASE",
      required: true,
      description: "Base URL for embedding API (e.g., https://api.openai.com/v1)",
    },
    {
      name: "EMBEDDING_API_KEY",
      required: true,
      description: "API key for embedding service",
    },
    {
      name: "EMBEDDING_MODEL",
      required: false,
      description: "Model to use (default: text-embedding-3-small)",
    },
  ],

  async beforeModel(ctx, plan) {
    const fs = ctx.agent.fs;
    if (!fs) return;

    const vars = ctx.agent.vars as Record<string, unknown>;

    // Inject available memory disks into system prompt
    try {
      const disks = await listDisks(fs);
      if (disks.length > 0) {
        const diskList = disks
          .map((d) => {
            const desc = d.description ? ` - ${d.description}` : "";
            return `  - **${d.name}** (${d.entryCount} entries)${desc}`;
          })
          .join("\n");

        plan.addSystemPrompt(`
## Memory Disks Available

You have access to the following memory disks for recall and storage:
${diskList}

Use the \`recall\` tool to search memories and \`remember\` tool to store new ones.
`);
      }
    } catch (e) {
      // Silent fail - disks might not exist yet
    }

    // Register recall tool (search)
    ctx.registerTool(tool({
      name: "recall",
      description: `Search a memory disk for relevant information using semantic search.
Use this to retrieve past knowledge, context, or facts stored in memory.
Memory disks available are listed in your system prompt.`,
      inputSchema: z.object({
        disk: z.string().describe("Name of the memory disk to search"),
        query: z.string().describe("Search query - describe what you're looking for"),
        k: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Number of results to return (default: 5)"),
      }),
      execute: async ({ disk, query, k }) => {
        try {
          const results = await searchDisk(fs, vars, disk, query, k ?? 5);
          if (results.length === 0) {
            return `No relevant memories found in '${disk}' for: ${query}`;
          }
          return results
            .map((r, i) => {
              const extra = r.extra ? ` [${JSON.stringify(r.extra)}]` : "";
              return `${i + 1}. ${r.content}${extra}`;
            })
            .join("\n\n");
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }));

    // Register remember tool (store)
    ctx.registerTool(tool({
      name: "remember",
      description: `Store a new memory to a memory disk.
Use this to save important information, facts, or context for future reference.
If the disk doesn't exist, it will be created automatically.`,
      inputSchema: z.object({
        disk: z.string().describe("Name of the memory disk to store to"),
        content: z.string().describe("The memory content to store (be descriptive and self-contained)"),
        tags: z
          .record(z.unknown())
          .optional()
          .describe("Optional metadata tags (e.g., { source: 'user', topic: 'preferences' })"),
      }),
      execute: async ({ disk, content, tags }) => {
        try {
          const result = await addMemory(fs, vars, disk, content, tags);
          return result.message;
        } catch (e) {
          return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }));
  },
};
