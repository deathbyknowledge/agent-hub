/**
 * Message conversion utilities for OTel-compliant message format.
 * Provides bidirectional conversion between legacy flat format and OTel parts[] format.
 */

import type {
  LegacyChatMessage,
  OTelMessage,
  MessagePart,
  TextPart,
  ToolCallPart,
  ToolCallResponsePart,
  ReasoningPart,
  ToolCall,
  FinishReason,
} from "./types";

// =============================================================================
// Legacy -> OTel Conversion
// =============================================================================

/**
 * Convert a legacy ChatMessage to OTel format with parts[].
 */
export function toOTelMessage(msg: LegacyChatMessage): OTelMessage {
  const parts: MessagePart[] = [];
  let finish_reason: FinishReason | undefined;

  if (msg.role === "system" || msg.role === "user") {
    parts.push({ type: "text", content: msg.content });
  } else if (msg.role === "assistant") {
    // Add reasoning part if present
    if ("reasoning" in msg && msg.reasoning) {
      parts.push({ type: "reasoning", content: msg.reasoning });
    }

    if ("toolCalls" in msg && msg.toolCalls) {
      // Assistant message with tool calls
      for (const tc of msg.toolCalls) {
        parts.push({
          type: "tool_call",
          id: tc.id,
          name: tc.name,
          arguments: tc.args,
        });
      }
      finish_reason = "tool_call";
    } else if ("content" in msg && msg.content) {
      // Assistant message with text content
      parts.push({ type: "text", content: msg.content });
      finish_reason = "stop";
    }
  } else if (msg.role === "tool") {
    parts.push({
      type: "tool_call_response",
      id: msg.toolCallId,
      response: msg.content,
    });
  }

  return {
    role: msg.role,
    parts,
    ts: msg.ts,
    ...(finish_reason && { finish_reason }),
  };
}

/**
 * Convert an array of legacy messages to OTel format.
 */
export function toOTelMessages(msgs: LegacyChatMessage[]): OTelMessage[] {
  return msgs.map(toOTelMessage);
}

// =============================================================================
// OTel -> Legacy Conversion
// =============================================================================

/**
 * Convert an OTel message to legacy ChatMessage format.
 * Note: Some information may be lost (e.g., multiple text parts merged).
 */
export function fromOTelMessage(msg: OTelMessage): LegacyChatMessage {
  const base = { ts: msg.ts };

  if (msg.role === "system" || msg.role === "user") {
    const textContent = extractTextContent(msg.parts);
    return { ...base, role: msg.role, content: textContent };
  }

  if (msg.role === "assistant") {
    const reasoning = extractReasoning(msg.parts);
    const toolCalls = extractToolCalls(msg.parts);
    const textContent = extractTextContent(msg.parts);

    if (toolCalls.length > 0) {
      return {
        ...base,
        role: "assistant",
        ...(reasoning && { reasoning }),
        toolCalls,
      } as LegacyChatMessage;
    }

    return {
      ...base,
      role: "assistant",
      ...(reasoning && { reasoning }),
      content: textContent,
    } as LegacyChatMessage;
  }

  if (msg.role === "tool") {
    const toolResponse = extractToolResponse(msg.parts);
    return {
      ...base,
      role: "tool",
      content: toolResponse.content,
      toolCallId: toolResponse.id,
    };
  }

  // Fallback for unknown roles
  return { ...base, role: "user", content: extractTextContent(msg.parts) };
}

/**
 * Convert an array of OTel messages to legacy format.
 */
export function fromOTelMessages(msgs: OTelMessage[]): LegacyChatMessage[] {
  return msgs.map(fromOTelMessage);
}

// =============================================================================
// Part Extraction Helpers
// =============================================================================

/**
 * Extract and concatenate all text content from message parts.
 */
export function extractTextContent(parts: MessagePart[]): string {
  return parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.content)
    .join("\n");
}

/**
 * Extract reasoning content from message parts.
 */
export function extractReasoning(parts: MessagePart[]): string | undefined {
  const reasoningParts = parts.filter(
    (p): p is ReasoningPart => p.type === "reasoning"
  );
  if (reasoningParts.length === 0) return undefined;
  return reasoningParts.map((p) => p.content).join("\n");
}

/**
 * Extract tool calls from message parts.
 */
export function extractToolCalls(parts: MessagePart[]): ToolCall[] {
  return parts
    .filter((p): p is ToolCallPart => p.type === "tool_call")
    .map((p) => ({
      id: p.id,
      name: p.name,
      args: p.arguments,
    }));
}

/**
 * Extract tool response from message parts.
 * Returns the first tool_call_response found.
 */
export function extractToolResponse(
  parts: MessagePart[]
): { id: string; content: string } {
  const responsePart = parts.find(
    (p): p is ToolCallResponsePart => p.type === "tool_call_response"
  );

  if (!responsePart) {
    return { id: "", content: "" };
  }

  return {
    id: responsePart.id,
    content:
      typeof responsePart.response === "string"
        ? responsePart.response
        : JSON.stringify(responsePart.response),
  };
}

// =============================================================================
// Part Construction Helpers
// =============================================================================

/**
 * Create a text part.
 */
export function textPart(content: string): TextPart {
  return { type: "text", content };
}

/**
 * Create a tool call part.
 */
export function toolCallPart(
  id: string,
  name: string,
  args: unknown
): ToolCallPart {
  return { type: "tool_call", id, name, arguments: args };
}

/**
 * Create a tool call response part.
 */
export function toolResponsePart(
  id: string,
  response: unknown
): ToolCallResponsePart {
  return { type: "tool_call_response", id, response };
}

/**
 * Create a reasoning part.
 */
export function reasoningPart(content: string): ReasoningPart {
  return { type: "reasoning", content };
}

// =============================================================================
// Message Construction Helpers
// =============================================================================

/**
 * Create a user message in OTel format.
 */
export function userMessage(content: string, ts?: string): OTelMessage {
  return { role: "user", parts: [textPart(content)], ts };
}

/**
 * Create a system message in OTel format.
 */
export function systemMessage(content: string, ts?: string): OTelMessage {
  return { role: "system", parts: [textPart(content)], ts };
}

/**
 * Create an assistant text message in OTel format.
 */
export function assistantMessage(
  content: string,
  options?: { reasoning?: string; ts?: string }
): OTelMessage {
  const parts: MessagePart[] = [];
  if (options?.reasoning) {
    parts.push(reasoningPart(options.reasoning));
  }
  parts.push(textPart(content));
  return { role: "assistant", parts, finish_reason: "stop", ts: options?.ts };
}

/**
 * Create an assistant message with tool calls in OTel format.
 */
export function assistantToolCallMessage(
  toolCalls: ToolCall[],
  options?: { reasoning?: string; ts?: string }
): OTelMessage {
  const parts: MessagePart[] = [];
  if (options?.reasoning) {
    parts.push(reasoningPart(options.reasoning));
  }
  for (const tc of toolCalls) {
    parts.push(toolCallPart(tc.id, tc.name, tc.args));
  }
  return {
    role: "assistant",
    parts,
    finish_reason: "tool_call",
    ts: options?.ts,
  };
}

/**
 * Create a tool result message in OTel format.
 */
export function toolMessage(
  toolCallId: string,
  response: unknown,
  ts?: string
): OTelMessage {
  return { role: "tool", parts: [toolResponsePart(toolCallId, response)], ts };
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Check if a message has tool calls.
 */
export function hasToolCalls(msg: OTelMessage): boolean {
  return msg.parts.some((p) => p.type === "tool_call");
}

/**
 * Check if a message has text content.
 */
export function hasTextContent(msg: OTelMessage): boolean {
  return msg.parts.some((p) => p.type === "text");
}

/**
 * Check if a message is a tool response.
 */
export function isToolResponse(msg: OTelMessage): boolean {
  return msg.role === "tool";
}

/**
 * Get the number of tool calls in a message.
 */
export function getToolCallCount(msg: OTelMessage): number {
  return msg.parts.filter((p) => p.type === "tool_call").length;
}
