import type { AgentPlugin, PluginContext, ChatMessage } from "../types";
import type { HubAgent } from "../agent";
import type { ModelPlanBuilder } from "../plan";
import type { AgentEvent } from "../events";
import { fromOTelMessages } from "../messages";
import {
  DEFAULT_CONTEXT_KEEP_RECENT,
  DEFAULT_CONTEXT_SUMMARIZE_AT,
} from "../config";

/**
 * Event type for context summarization.
 * This is a plugin-specific event, not part of the core runtime.
 */
const CONTEXT_SUMMARIZED = "gen_ai.context.summarized";

/**
 * Data payload for CONTEXT_SUMMARIZED event.
 */
type ContextSummarizedEventData = {
  /** The summary text */
  "context.summary": string;
  /** Number of messages that were summarized (from start of conversation) */
  "context.summarized_count": number;
  /** Number of recent messages kept (not summarized) */
  "context.kept_count": number;
  /** Previous summary that was incorporated (if any) */
  "context.previous_summary"?: string;
  /** Path where full messages were archived */
  "context.archived_path"?: string;
  /** Memories extracted during summarization */
  "context.memories"?: string[];
};

// IDZ file format for memory storage
type IDZFile = {
  version: 1;
  name: string;
  description?: string;
  hasEmbeddings: boolean;
  entries: Array<{
    content: string;
    extra?: Record<string, unknown>;
    embedding?: number[];
  }>;
};

/**
 * Context summary state extracted from CONTEXT_SUMMARIZED events.
 */
type ContextSummaryState = {
  summary: string;
  summarizedCount: number;
  keptCount: number;
  seq: number;
};

const SUMMARIZATION_SYSTEM_PROMPT = `You are summarizing a conversation to preserve context while reducing length.

Create a concise summary that captures:
- Key decisions made
- Important information learned about the user or task
- Tasks completed and their outcomes
- Pending items or ongoing context

If there are important facts worth remembering long-term (user preferences, names, key facts learned), output them in a special section:

<memories>
- User's name is John
- User prefers concise responses
- Project deadline is January 15th
</memories>

Keep the summary focused and actionable. The agent will continue the conversation with only this summary as history.
Do NOT include the <memories> section if there are no new facts worth remembering.`;

/**
 * Find the latest CONTEXT_SUMMARIZED event from the event log.
 * This allows the plugin to be self-contained - it reads its own state from events.
 */
function findLatestSummary(events: AgentEvent[]): ContextSummaryState | null {
  // Iterate backwards to find the most recent summary
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === CONTEXT_SUMMARIZED) {
      const data = event.data as ContextSummarizedEventData;
      return {
        summary: data["context.summary"],
        summarizedCount: data["context.summarized_count"],
        keptCount: data["context.kept_count"],
        seq: event.seq ?? 0,
      };
    }
  }
  return null;
}

/**
 * Get context-aware messages from the projection, respecting any summarization.
 * This is the core logic that transforms full message history into a context window.
 */
function getContextMessages(
  allMessages: ChatMessage[],
  lastSummary: ContextSummaryState | null
): ChatMessage[] {
  if (!lastSummary) {
    return allMessages;
  }

  const { summary, summarizedCount } = lastSummary;

  // Skip the summarized messages, keep only messages after
  const recentMessages = allMessages.slice(summarizedCount);

  // Prepend summary as a user message
  const summaryMessage: ChatMessage = {
    role: "user",
    content: `[Previous Conversation Summary]\n${summary}\n\n---\nContinue from where we left off.`,
  };

  return [summaryMessage, ...recentMessages];
}

function buildSummaryPrompt(
  previousSummary: string | undefined,
  messages: ChatMessage[]
): string {
  let prompt = "";

  if (previousSummary) {
    prompt += `Previous conversation summary:\n${previousSummary}\n\n---\n\n`;
    prompt += "New messages to incorporate into the summary:\n\n";
  } else {
    prompt += "Messages to summarize:\n\n";
  }

  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    let content: string;

    if ("content" in msg && typeof msg.content === "string") {
      content = msg.content;
    } else if ("toolCalls" in msg && msg.toolCalls) {
      content = `[Tool calls: ${msg.toolCalls.map((tc: { name: string }) => tc.name).join(", ")}]`;
    } else {
      content = "[No content]";
    }

    // Truncate very long messages
    if (content.length > 500) {
      content = content.slice(0, 500) + "... [truncated]";
    }

    prompt += `[${role}]: ${content}\n\n`;
  }

  prompt += "---\n\n";
  prompt += "Provide an updated summary that incorporates all the above. ";
  prompt += "Be concise but preserve important context.";

  return prompt;
}

function parseSummaryResponse(content: string): {
  summary: string;
  memories: string[];
} {
  const memoriesMatch = content.match(/<memories>([\s\S]*?)<\/memories>/i);
  let memories: string[] = [];
  let summary = content;

  if (memoriesMatch) {
    // Remove memories block from summary
    summary = content.replace(/<memories>[\s\S]*?<\/memories>/i, "").trim();

    // Parse individual memories (lines starting with - or *)
    memories = memoriesMatch[1]
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0);
  }

  return { summary, memories };
}

async function archiveMessages(
  fs: HubAgent["fs"],
  messages: ChatMessage[],
  agentId: string,
  summarizedCount: number
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `~/logs/archive-${timestamp}.json`;

  const archive = {
    archivedAt: new Date().toISOString(),
    agentId,
    summarizedCount,
    messageCount: messages.length,
    messages,
  };

  await fs.writeFile(path, JSON.stringify(archive, null, 2));
  return path;
}

async function storeMemories(
  fs: HubAgent["fs"],
  diskName: string,
  memories: string[]
): Promise<void> {
  const path = `/shared/memories/${diskName}.idz`;
  let idz: IDZFile | null = null;

  // Try to load existing disk
  try {
    const content = await fs.readFile(path);
    idz = content ? JSON.parse(content) : null;
  } catch {
    idz = null;
  }

  // Create new disk if doesn't exist
  if (!idz) {
    idz = {
      version: 1,
      name: diskName,
      description: "Memories extracted from conversation summaries",
      hasEmbeddings: false,
      entries: [],
    };
  }

  // Add new memories with metadata
  const now = new Date().toISOString();
  for (const memory of memories) {
    idz.entries.push({
      content: memory,
      extra: {
        source: "context-summary",
        extractedAt: now,
      },
    });
  }

  // Mark as needing re-embedding since we added entries
  idz.hasEmbeddings = false;

  await fs.writeFile(path, JSON.stringify(idz));
}

/**
 * Context management plugin that automatically summarizes long conversations.
 * 
 * **Self-Contained Event-Sourced Design:**
 * This plugin reads events directly from the store, finds its own CONTEXT_SUMMARIZED
 * events, and determines what messages to use. It doesn't require any runtime changes
 * beyond the basic event storage.
 * 
 * When the message count exceeds CONTEXT_SUMMARIZE_AT, older messages are
 * summarized using an LLM call and archived to the filesystem. The summary
 * is stored as an event and used in future model requests.
 * 
 * @var CONTEXT_KEEP_RECENT - Messages to keep in full (default: 20)
 * @var CONTEXT_SUMMARIZE_AT - Trigger summarization threshold (default: 40)
 * @var CONTEXT_MEMORY_DISK - Optional disk name for extracted memories
 * @var CONTEXT_SUMMARY_MODEL - Optional model for summarization
 */
export const context: AgentPlugin = {
  name: "context",
  tags: ["context"],

  varHints: [
    {
      name: "CONTEXT_KEEP_RECENT",
      required: false,
      description: `Messages to keep in full (default: ${DEFAULT_CONTEXT_KEEP_RECENT})`,
    },
    {
      name: "CONTEXT_SUMMARIZE_AT",
      required: false,
      description: `Summarize when message count exceeds this (default: ${DEFAULT_CONTEXT_SUMMARIZE_AT})`,
    },
    {
      name: "CONTEXT_MEMORY_DISK",
      required: false,
      description: "Disk name to store extracted memories (optional)",
    },
    {
      name: "CONTEXT_SUMMARY_MODEL",
      required: false,
      description: "Model for summarization (uses agent's model by default)",
    },
  ],

  state(ctx: PluginContext) {
    // Read events directly - plugin is self-contained
    const events = ctx.agent.store.listEvents();
    const lastSummary = findLatestSummary(events);
    
    // Get message count from projection
    const projection = ctx.agent.projection;
    
    return {
      hasSummary: !!lastSummary,
      lastSummary: lastSummary?.summary?.slice(0, 100) + (lastSummary?.summary && lastSummary.summary.length > 100 ? "..." : ""),
      messageCount: projection.messages.length,
      summarizedCount: lastSummary?.summarizedCount ?? 0,
    };
  },

  async beforeModel(ctx: PluginContext, plan: ModelPlanBuilder) {
    // Get configuration with defaults
    const KEEP_RECENT = (ctx.agent.vars.CONTEXT_KEEP_RECENT as number) ?? DEFAULT_CONTEXT_KEEP_RECENT;
    const SUMMARIZE_AT = (ctx.agent.vars.CONTEXT_SUMMARIZE_AT as number) ?? DEFAULT_CONTEXT_SUMMARIZE_AT;
    const MEMORY_DISK = ctx.agent.vars.CONTEXT_MEMORY_DISK as string | undefined;
    const SUMMARY_MODEL = ctx.agent.vars.CONTEXT_SUMMARY_MODEL as string | undefined;

    // Read events and find our own summary state - plugin is self-contained
    const events = ctx.agent.store.listEvents();
    const lastSummary = findLatestSummary(events);

    // Get all messages from projection (in legacy format)
    const projection = ctx.agent.projection;
    const allMessages = fromOTelMessages(projection.messages);

    // Calculate effective message count (messages not yet summarized)
    const totalMessages = allMessages.length;
    const alreadySummarized = lastSummary?.summarizedCount ?? 0;
    const effectiveMessageCount = totalMessages - alreadySummarized;

    // Always set context-aware messages (respects existing summaries)
    const contextMessages = getContextMessages(allMessages, lastSummary);
    plan.setMessages(contextMessages.filter((m: ChatMessage) => m.role !== "system"));

    // Check if summarization is needed
    if (effectiveMessageCount <= SUMMARIZE_AT) {
      // No summarization needed - messages already set above
      return;
    }

    // Summarization needed!
    const fs = ctx.agent.fs;

    // Get messages that haven't been summarized yet
    // Filter out any existing summary message (starts with "[Previous Conversation Summary]")
    const messagesWithoutSummary = contextMessages.filter(
      (m: ChatMessage) => {
        if (m.role !== "user") return true;
        const content = typeof m.content === "string" ? m.content : "";
        return !content.startsWith("[Previous Conversation Summary]");
      }
    );

    if (messagesWithoutSummary.length <= KEEP_RECENT) {
      // Not enough messages to summarize
      return;
    }

    // Split into messages to summarize and messages to keep
    const toSummarize = messagesWithoutSummary.slice(0, -KEEP_RECENT);
    const toKeep = messagesWithoutSummary.slice(-KEEP_RECENT);

    // Build summarization prompt (include previous summary if exists)
    const summaryPrompt = buildSummaryPrompt(lastSummary?.summary, toSummarize);

    // Emit event so we know summarization started
    ctx.agent.emit("context.summarizing", {
      messageCount: toSummarize.length,
      keepingRecent: toKeep.length,
    });

    // Call LLM for summarization with timeout
    const SUMMARIZATION_TIMEOUT_MS = 60000; // 60s max
    let summaryResult;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SUMMARIZATION_TIMEOUT_MS);
      try {
        summaryResult = await ctx.agent.provider.invoke(
          {
            model: SUMMARY_MODEL ?? ctx.agent.model,
            systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
            messages: [{ role: "user", content: summaryPrompt }],
            toolDefs: [],
          },
          { signal: controller.signal }
        );
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      ctx.agent.emit("context.error", { 
        phase: "summarization",
        error: errorMsg,
      });
      console.error("context: Summarization failed:", errorMsg);
      return;
    }

    // Parse the response
    const msg = summaryResult.message;
    let responseContent: string;
    if ("content" in msg && typeof msg.content === "string") {
      responseContent = msg.content;
    } else {
      responseContent = "[No content in summarization response]";
    }

    const { summary, memories } = parseSummaryResponse(responseContent);

    // Store extracted memories if disk configured and memories found
    if (MEMORY_DISK && memories.length > 0) {
      try {
        await storeMemories(fs, MEMORY_DISK, memories);
      } catch (err) {
        console.warn("context: Failed to store memories:", err);
      }
    }

    // Archive messages to filesystem
    let archivePath: string | undefined;
    try {
      archivePath = await archiveMessages(
        fs,
        toSummarize,
        ctx.agent.info.threadId || "unknown",
        toSummarize.length
      );
    } catch (err) {
      console.warn("context: Failed to archive messages:", err);
    }

    // Calculate new summarized count
    // This is the total number of messages from the start that are now summarized
    const newSummarizedCount = alreadySummarized + toSummarize.length;

    // Emit CONTEXT_SUMMARIZED event - this is how we persist our state
    ctx.agent.emit(CONTEXT_SUMMARIZED, {
      "context.summary": summary,
      "context.summarized_count": newSummarizedCount,
      "context.kept_count": toKeep.length,
      "context.previous_summary": lastSummary?.summary,
      "context.archived_path": archivePath,
      "context.memories": memories.length > 0 ? memories : undefined,
    });

    // Emit event for UI visibility
    ctx.agent.emit("context.summarized", {
      messagesSummarized: toSummarize.length,
      totalSummarized: newSummarizedCount,
      memoriesExtracted: memories.length,
      archivedTo: archivePath,
      summaryLength: summary.length,
    });

    // Update messages for THIS request with the new summary
    const summaryMessage: ChatMessage = {
      role: "user",
      content: `[Previous Conversation Summary]\n${summary}\n\n---\nContinue from where we left off.`,
    };
    plan.setMessages([
      summaryMessage,
      ...toKeep.filter((m: ChatMessage) => m.role !== "system"),
    ]);
  },
};
