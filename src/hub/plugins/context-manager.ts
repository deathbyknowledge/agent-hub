/**
 * Context Manager Plugin
 *
 * Provides long-term memory for agents using the filesystem.
 * Automatically retrieves relevant context and provides tools for
 * explicit memory management (remember, recall, forget).
 */
import { definePlugin, tool, z, type ChatMessage } from "@runtime";

type MemoryEntry = {
  id: string;
  content: string;
  tags: string[];
  createdAt: number;
  type: "fact" | "summary" | "note";
};

type MemoryIndex = {
  entries: MemoryEntry[];
};

const MEMORY_INDEX_PATH = "~/memory/.index.json";

async function loadIndex(fs: { readFile: (path: string) => Promise<string | null> }): Promise<MemoryIndex> {
  try {
    const raw = await fs.readFile(MEMORY_INDEX_PATH);
    if (raw) return JSON.parse(raw);
  } catch {
    // Index doesn't exist yet
  }
  return { entries: [] };
}

async function saveIndex(
  fs: { writeFile: (path: string, content: string) => Promise<void> },
  index: MemoryIndex
): Promise<void> {
  await fs.writeFile(MEMORY_INDEX_PATH, JSON.stringify(index, null, 2));
}

export const contextManager = definePlugin({
  name: "context_manager",

  async onInit(ctx) {
    const fs = ctx.agent.fs;
    if (!fs) return;

    // Initialize memory index if it doesn't exist
    const index = await loadIndex(fs);
    if (index.entries.length === 0) {
      await saveIndex(fs, { entries: [] });
    }
  },

  async beforeModel(ctx, plan) {
    const fs = ctx.agent.fs;
    if (!fs) return;

    const index = await loadIndex(fs);

    // Get the last user message for relevance matching
    const messages = ctx.agent.messages as ChatMessage[];
    const lastUserMessage = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    const query = ("content" in (lastUserMessage ?? {}) 
      ? (lastUserMessage as { content: string }).content 
      : "").toLowerCase();

    // Inject relevant memories if any exist
    if (index.entries.length) {
      // Simple relevance: include recent entries + keyword matches
      const now = Date.now();
      const DAY_MS = 24 * 60 * 60 * 1000;

      const relevant = index.entries
        .filter((e) => {
          // Include if recent (last 24h)
          const isRecent = now - e.createdAt < DAY_MS;
          // Include if any tag matches query
          const hasTagMatch = e.tags.some((t) =>
            query.includes(t.toLowerCase())
          );
          // Include if content partially matches query (first 100 chars)
          const hasContentMatch =
            query.length > 3 &&
            e.content.toLowerCase().includes(query.slice(0, 100));

          return isRecent || hasTagMatch || hasContentMatch;
        })
        .slice(-10); // Limit to 10 most relevant

      if (relevant.length) {
        const memoryBlock = relevant
          .map((e) => `- [${e.type}] ${e.content}`)
          .join("\n");

        plan.addSystemPrompt(`## Long-term Memory

The following information was saved from previous interactions:

${memoryBlock}

Use this context to inform your responses. You can save new memories with the \`remember\` tool.`);
      }
    }

    // Register memory tools
    const rememberTool = tool({
      name: "remember",
      description:
        "Save important information to long-term memory for future reference. Use this for facts, preferences, or summaries that should persist across conversations.",
      inputSchema: z.object({
        content: z.string().describe("The information to remember"),
        tags: z
          .array(z.string())
          .describe("Keywords/tags for retrieval (e.g., ['user_preference', 'project_name'])"),
        type: z
          .enum(["fact", "summary", "note"])
          .default("note")
          .describe("Type of memory: fact (verified info), summary (conversation summary), note (general)"),
      }),
      execute: async ({ content, tags, type }, toolCtx) => {
        const agentFs = toolCtx.agent.fs;
        if (!agentFs) return "Error: Filesystem not available";

        const memIndex = await loadIndex(agentFs);

        const entry: MemoryEntry = {
          id: crypto.randomUUID(),
          content,
          tags,
          type: type ?? "note",
          createdAt: Date.now(),
        };

        memIndex.entries.push(entry);
        await saveIndex(agentFs, memIndex);

        return `Remembered: "${content.slice(0, 50)}${content.length > 50 ? "..." : ""}" with tags [${tags.join(", ")}]`;
      },
    });

    const recallTool = tool({
      name: "recall",
      description:
        "Search long-term memory for relevant information. Use this to find previously saved facts, summaries, or notes.",
      inputSchema: z.object({
        query: z.string().describe("Search query or keywords"),
      }),
      execute: async ({ query: q }, toolCtx) => {
        const agentFs = toolCtx.agent.fs;
        if (!agentFs) return "Error: Filesystem not available";

        const memIndex = await loadIndex(agentFs);
        if (!memIndex.entries.length) return "No memories found.";

        const queryLower = q.toLowerCase();
        const matches = memIndex.entries.filter(
          (e) =>
            e.content.toLowerCase().includes(queryLower) ||
            e.tags.some((t) => t.toLowerCase().includes(queryLower))
        );

        if (!matches.length) return "No relevant memories found.";

        return matches
          .map(
            (e) =>
              `[${e.type}] ${e.content} (tags: ${e.tags.join(", ")}, saved: ${new Date(e.createdAt).toLocaleDateString()})`
          )
          .join("\n\n");
      },
    });

    const forgetTool = tool({
      name: "forget",
      description:
        "Remove memories that match a query. Use this to clear outdated or incorrect information.",
      inputSchema: z.object({
        query: z.string().describe("Content or tag to match and remove"),
      }),
      execute: async ({ query: q }, toolCtx) => {
        const agentFs = toolCtx.agent.fs;
        if (!agentFs) return "Error: Filesystem not available";

        const memIndex = await loadIndex(agentFs);
        if (!memIndex.entries.length) return "No memories to forget.";

        const queryLower = q.toLowerCase();
        const before = memIndex.entries.length;

        memIndex.entries = memIndex.entries.filter(
          (e) =>
            !e.content.toLowerCase().includes(queryLower) &&
            !e.tags.some((t) => t.toLowerCase().includes(queryLower))
        );

        await saveIndex(agentFs, memIndex);

        const removed = before - memIndex.entries.length;
        return removed > 0
          ? `Forgot ${removed} memory(ies) matching "${q}".`
          : "No matching memories found.";
      },
    });

    const listMemoriesTool = tool({
      name: "list_memories",
      description: "List all saved memories, optionally filtered by type",
      inputSchema: z.object({
        type: z
          .enum(["fact", "summary", "note", "all"])
          .default("all")
          .describe("Filter by memory type"),
      }),
      execute: async ({ type: memType }, toolCtx) => {
        const agentFs = toolCtx.agent.fs;
        if (!agentFs) return "Error: Filesystem not available";

        const memIndex = await loadIndex(agentFs);
        if (!memIndex.entries.length) return "No memories saved yet.";

        const filtered =
          memType === "all"
            ? memIndex.entries
            : memIndex.entries.filter((e) => e.type === memType);

        if (!filtered.length) return `No ${memType} memories found.`;

        return filtered
          .map(
            (e) =>
              `[${e.type}] ${e.content.slice(0, 100)}${e.content.length > 100 ? "..." : ""} (tags: ${e.tags.join(", ")})`
          )
          .join("\n\n");
      },
    });

    ctx.registerTool(rememberTool);
    ctx.registerTool(recallTool);
    ctx.registerTool(forgetTool);
    ctx.registerTool(listMemoriesTool);
  },

  tags: ["memory", "context"],
});
