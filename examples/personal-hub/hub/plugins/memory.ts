/**
 * Memory Plugin
 *
 * Provides semantic search over agency-wide memory disks.
 * Each disk is stored as a single `.idz` file in /shared/memories/.
 *
 * File format (.idz):
 * {
 *   version: 1,
 *   name: string,
 *   description?: string,
 *   hasEmbeddings: boolean,
 *   entries: { content: string, extra?: Record<string, unknown>, embedding?: number[] }[]
 * }
 *
 * Embeddings are computed via external API configured in vars:
 *   - EMBEDDING_API_BASE (e.g., "https://api.openai.com/v1")
 *   - EMBEDDING_API_KEY
 *   - EMBEDDING_MODEL (default: "text-embedding-3-small")
 */
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

async function listDisks(fs: AgentFileSystem): Promise<{ name: string }[]> {
  const entries = await fs.readDir("/shared/memories").catch(() => []);
  return entries
    .filter((e) => e.type === "file" && e.path.endsWith(".idz"))
    .map((e) => ({ name: e.path.replace(/.*\//, "").replace(/\.idz$/, "") }));
}

async function searchDisk(
  fs: AgentFileSystem,
  vars: Record<string, unknown>,
  name: string,
  query: string,
  k: number
): Promise<MemoryEntry[]> {
  const content = await fs.readFile(diskPath(name));
  if (!content) throw new Error(`Disk '${name}' not found`);

  const idz = JSON.parse(content) as IDZFile;
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
    await fs.writeFile(diskPath(name), JSON.stringify(updated));
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

// ============================================================
// Plugin
// ============================================================

export const memory: AgentPlugin = {
  name: "memory",

  async beforeModel(ctx) {
    const fs = ctx.agent.fs;
    if (!fs) return;

    const vars = ctx.agent.vars as Record<string, unknown>;

    const recallTool = tool({
      name: "recall",
      description: `Search agency memory for relevant information.
Use this to retrieve past knowledge, context, or facts stored in memory disks.
Available disks can be listed first, then searched by name.`,
      inputSchema: z.object({
        action: z
          .enum(["list", "search"])
          .describe("Action: 'list' disks or 'search' a disk"),
        disk: z.string().optional().describe("Disk name (required for search)"),
        query: z
          .string()
          .optional()
          .describe("Search query (required for search)"),
        k: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Results to return (default: 5)"),
      }),
      execute: async ({ action, disk, query, k }) => {
        if (action === "list") {
          const disks = await listDisks(fs);
          if (disks.length === 0) return "No memory disks available.";
          return disks.map((d) => `- ${d.name}`).join("\n");
        }

        if (action === "search") {
          if (!disk) return "Error: disk name required for search";
          if (!query) return "Error: query required for search";

          try {
            const results = await searchDisk(fs, vars, disk, query, k ?? 5);
            if (results.length === 0) {
              return `No results found in '${disk}' for: ${query}`;
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
        }

        return "Error: invalid action";
      },
    });

    ctx.registerTool(recallTool);
  },

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
};
