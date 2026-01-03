import { HNSW } from "hnsw";
import { tool, z, type AgentPlugin } from "agent-hub";
import type { AgentFileSystem } from "lib/runtime/fs";

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
    throw new Error(`Embedding API error: ${res.status} - ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function listDisks(
  fs: AgentFileSystem
): Promise<Array<{ name: string; description?: string; entryCount: number }>> {
  const entries = await fs.readDir("/shared/memories").catch(() => []);
  const disks: Array<{ name: string; description?: string; entryCount: number }> = [];

  for (const entry of entries) {
    if (entry.type === "file" && entry.path.endsWith(".idz")) {
      const name = entry.path.replace(/.*\//, "").replace(/\.idz$/, "");
      try {
        const content = await fs.readFile(entry.path);
        if (content) {
          const idz = JSON.parse(content) as IDZFile;
          disks.push({
            name,
            description: idz.description,
            entryCount: idz.entries?.length || 0,
          });
        }
      } catch {
        disks.push({ name, entryCount: 0 });
      }
    }
  }

  return disks;
}

async function loadDisk(fs: AgentFileSystem, name: string): Promise<IDZFile | null> {
  const content = await fs.readFile(diskPath(name));
  if (!content) return null;
  return JSON.parse(content) as IDZFile;
}

async function saveDisk(fs: AgentFileSystem, idz: IDZFile): Promise<void> {
  await fs.writeFile(diskPath(idz.name), JSON.stringify(idz));
}

async function searchDisk(
  fs: AgentFileSystem,
  vars: Record<string, unknown>,
  name: string,
  query: string,
  k: number
): Promise<MemoryEntry[]> {
  const idz = await loadDisk(fs, name);
  if (!idz) throw new Error(`Disk '${name}' not found`);

  let entries = idz.entries;

  // Compute embeddings if missing
  if (!idz.hasEmbeddings && entries.length > 0) {
    const embeddings = await fetchEmbeddings(
      entries.map((e) => e.content),
      vars
    );
    entries = entries.map((e, i) => ({ ...e, embedding: embeddings[i] }));
    // Save back with embeddings
    const updated: IDZFile = { ...idz, hasEmbeddings: true, entries };
    await saveDisk(fs, updated);
  }

  if (entries.length === 0) return [];

  // Build index and search
  const hnsw = new HNSW(32, 200, null, "cosine");
  const indexData = entries
    .map((e, i) => (e.embedding ? { id: i, vector: e.embedding } : null))
    .filter(Boolean) as { id: number; vector: number[] }[];

  if (indexData.length === 0) return [];
  await hnsw.buildIndex(indexData);

  const [queryVec] = await fetchEmbeddings([query], vars);
  const results = hnsw.searchKNN(queryVec, Math.min(k, indexData.length));

  return results
    .map((r) => entries[r.id])
    .filter(Boolean)
    .map((e) => ({ content: e.content, extra: e.extra }));
}

async function addMemory(
  fs: AgentFileSystem,
  vars: Record<string, unknown>,
  diskName: string,
  content: string,
  extra?: Record<string, unknown>
): Promise<{ success: boolean; message: string }> {
  let idz = await loadDisk(fs, diskName);

  // Create disk if it doesn't exist
  if (!idz) {
    idz = {
      version: 1,
      name: diskName,
      hasEmbeddings: false,
      entries: [],
    };
  }

  // Add the new entry (without embedding - will be computed on search)
  const newEntry: StoredEntry = { content, extra };
  
  // If disk already has embeddings, compute embedding for new entry
  if (idz.hasEmbeddings) {
    try {
      const [embedding] = await fetchEmbeddings([content], vars);
      newEntry.embedding = embedding;
    } catch (e) {
      // If embedding fails, mark disk as needing re-embedding
      idz.hasEmbeddings = false;
    }
  }

  idz.entries.push(newEntry);
  await saveDisk(fs, idz);

  return {
    success: true,
    message: `Added memory to '${diskName}' (${idz.entries.length} total entries)`,
  };
}

export const memory: AgentPlugin = {
  name: "memory",
  tags: ["memory"],

  varHints: [
    {
      name: "EMBEDDING_API_BASE",
      required: true,
      description:
        "Base URL for embedding API (e.g., https://api.openai.com/v1)",
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
