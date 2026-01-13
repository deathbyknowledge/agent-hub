import type { AgentPlugin, PluginContext, ChatMessage } from "../types";
import type { HubAgent } from "../agent";
import type { ModelPlanBuilder } from "../plan";
import {
  DEFAULT_CONTEXT_KEEP_RECENT,
  DEFAULT_CONTEXT_SUMMARIZE_AT,
} from "../config";

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
  startSeq: number,
  endSeq: number,
  agentId: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `~/logs/archive-${timestamp}.json`;

  const archive = {
    archivedAt: new Date().toISOString(),
    agentId,
    sequenceRange: { start: startSeq, end: endSeq },
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
 * When the message count exceeds CONTEXT_SUMMARIZE_AT, older messages are
 * summarized using an LLM call, archived to the filesystem, and deleted
 * from the active context. The summary is prepended to future requests.
 * 
 * Optionally extracts important facts as "memories" and stores them to
 * a memory disk for long-term retrieval.
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
    const checkpoint = ctx.agent.store.getLatestCheckpoint();
    return {
      hasCheckpoint: !!checkpoint,
      checkpointCount: ctx.agent.store.getCheckpointCount(),
      lastSummaryAt: checkpoint?.createdAt
        ? new Date(checkpoint.createdAt).toISOString()
        : null,
    };
  },

  async beforeModel(ctx: PluginContext, plan: ModelPlanBuilder) {
    // Get configuration with defaults
    const KEEP_RECENT = (ctx.agent.vars.CONTEXT_KEEP_RECENT as number) ?? DEFAULT_CONTEXT_KEEP_RECENT;
    const SUMMARIZE_AT = (ctx.agent.vars.CONTEXT_SUMMARIZE_AT as number) ?? DEFAULT_CONTEXT_SUMMARIZE_AT;
    const MEMORY_DISK = ctx.agent.vars.CONTEXT_MEMORY_DISK as string | undefined;
    const SUMMARY_MODEL = ctx.agent.vars.CONTEXT_SUMMARY_MODEL as string | undefined;

    const store = ctx.agent.store;
    const checkpoint = store.getLatestCheckpoint();

    // Get current message count (after checkpoint if exists)
    const totalMessages = store.getMessageCount();
    const checkpointEndSeq = checkpoint?.messagesEndSeq ?? 0;

    // Count messages after the checkpoint
    const messagesAfterCheckpoint = checkpoint
      ? store.getMessagesAfter(checkpointEndSeq).length
      : totalMessages;

    // Check if summarization is needed
    if (messagesAfterCheckpoint <= SUMMARIZE_AT) {
      // No summarization needed
      // But if we have a checkpoint, prepend the summary to messages
      if (checkpoint) {
        const recentMessages = store.getMessagesAfter(checkpointEndSeq);
        plan.setMessages([
          {
            role: "user",
            content: `[Previous Conversation Summary]\n${checkpoint.summary}\n\n---\nContinue from where we left off.`,
          },
          ...recentMessages.filter((m: ChatMessage) => m.role !== "system"),
        ]);
      }
      return;
    }

    // Summarization needed!
    const fs = ctx.agent.fs;

    // Get all messages after checkpoint
    const allMessages = checkpoint
      ? store.getMessagesAfter(checkpointEndSeq)
      : store.getContext(1000);

    if (allMessages.length <= KEEP_RECENT) {
      // Not enough messages to summarize
      return;
    }

    // Split into messages to summarize and messages to keep
    const toSummarize = allMessages.slice(0, -KEEP_RECENT);
    const toKeep = allMessages.slice(-KEEP_RECENT);

    // Build summarization prompt
    const summaryPrompt = buildSummaryPrompt(checkpoint?.summary, toSummarize);

    // Call LLM for summarization
    let summaryResult;
    try {
      summaryResult = await ctx.agent.provider.invoke(
        {
          model: SUMMARY_MODEL ?? ctx.agent.model,
          systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: summaryPrompt }],
          toolDefs: [],
        },
        {}
      );
    } catch (err) {
      console.error("context: Summarization failed:", err);
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

    // Calculate sequence range for archiving
    // We need the actual seq numbers from the DB
    const maxSeq = store.getMaxMessageSeq();
    const startSeq = checkpointEndSeq + 1;
    const endSeq = maxSeq - KEEP_RECENT;

    // Archive messages to filesystem
    let archivePath: string | undefined;
    try {
      archivePath = await archiveMessages(
        fs,
        toSummarize,
        startSeq,
        endSeq,
        ctx.agent.info.threadId || "unknown"
      );
    } catch (err) {
      console.warn("context: Failed to archive messages:", err);
    }

    // Store checkpoint in DB
    store.addCheckpoint(summary, startSeq, endSeq, archivePath);

    // Delete old messages from DB
    const deleted = store.deleteMessagesBefore(endSeq);

    // Emit event for UI visibility
    ctx.agent.emit("context.summarized", {
      messagesSummarized: toSummarize.length,
      messagesDeleted: deleted,
      memoriesExtracted: memories.length,
      archivedTo: archivePath,
      summaryLength: summary.length,
    });

    // Set messages for this request: summary + recent messages
    // Use "user" role for summary since many LLMs don't allow starting with "assistant"
    plan.setMessages([
      {
        role: "user",
        content: `[Previous Conversation Summary]\n${summary}\n\n---\nContinue from where we left off.`,
      },
      ...toKeep.filter((m: ChatMessage) => m.role !== "system"),
    ]);
  },
};
