/**
 * Shared utility functions
 */
import type { ChatMessage, Message, ToolCall, APIToolCall } from "./types";

/**
 * Convert API ChatMessage[] to Message[] for ChatView
 * Handles tool calls, tool results, reasoning, and timestamps
 */
export function convertChatMessages(apiMessages: ChatMessage[]): Message[] {
  const messages: Message[] = [];
  const toolResults = new Map<string, { content: string; status: "done" | "error" }>();

  // First pass: collect tool results
  for (const msg of apiMessages) {
    if (msg.role === "tool") {
      const toolMsg = msg as { role: "tool"; content: string; toolCallId: string };
      toolResults.set(toolMsg.toolCallId, { content: toolMsg.content, status: "done" });
    }
  }

  // Second pass: build messages with tool calls
  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i];
    const timestamp = msg.ts || "";

    if (msg.role === "tool") {
      // Skip tool messages - they're attached to assistant messages
      continue;
    }

    if (msg.role === "assistant") {
      const assistantMsg = msg as
        | { role: "assistant"; content: string; reasoning?: string; ts?: string }
        | { role: "assistant"; toolCalls?: APIToolCall[]; reasoning?: string; ts?: string };

      const reasoning = "reasoning" in assistantMsg ? assistantMsg.reasoning : undefined;

      if ("toolCalls" in assistantMsg && assistantMsg.toolCalls?.length) {
        const toolCalls: ToolCall[] = assistantMsg.toolCalls.map((tc) => {
          const result = toolResults.get(tc.id);
          return {
            id: tc.id,
            name: tc.name,
            args: tc.args as Record<string, unknown>,
            result: result?.content,
            status: result ? result.status : ("running" as const),
          };
        });

        const content = "content" in assistantMsg
          ? (assistantMsg as { content?: string }).content || ""
          : "";

        messages.push({
          id: `msg-${i}`,
          role: "assistant",
          content,
          timestamp,
          toolCalls,
          reasoning,
        });
      } else if ("content" in assistantMsg && assistantMsg.content) {
        messages.push({
          id: `msg-${i}`,
          role: "assistant",
          content: assistantMsg.content,
          timestamp,
          reasoning,
        });
      }
    } else {
      // User or system message
      const contentMsg = msg as { role: "user" | "system"; content: string };
      messages.push({
        id: `msg-${i}`,
        role: contentMsg.role,
        content: contentMsg.content || "",
        timestamp,
      });
    }
  }

  return messages;
}

/**
 * Format timestamp for display in chat/activity
 */
export function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

/**
 * Format relative time (e.g., "5m ago", "2h ago")
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Format duration in ms to human-readable
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Format large numbers with K/M suffix
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Shorten an ID to first N characters
 */
export function shortId(id: string, length = 8): string {
  return (id || "").slice(0, length);
}


