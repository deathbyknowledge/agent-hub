import { describe, expect, it } from "vitest";
import {
  toOTelMessage,
  toOTelMessages,
  fromOTelMessage,
  fromOTelMessages,
  extractTextContent,
  extractReasoning,
  extractToolCalls,
  extractToolResponse,
  textPart,
  toolCallPart,
  toolResponsePart,
  reasoningPart,
  userMessage,
  systemMessage,
  assistantMessage,
  assistantToolCallMessage,
  toolMessage,
  hasToolCalls,
  hasTextContent,
  isToolResponse,
  getToolCallCount,
} from "../runtime/messages";
import type { LegacyChatMessage, OTelMessage, MessagePart } from "../runtime/types";

describe("Message Conversions", () => {
  describe("toOTelMessage", () => {
    it("should convert user message", () => {
      const legacy: LegacyChatMessage = {
        role: "user",
        content: "Hello, world!",
        ts: "2024-01-01T00:00:00Z",
      };

      const result = toOTelMessage(legacy);

      expect(result.role).toBe("user");
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]).toEqual({ type: "text", content: "Hello, world!" });
      expect(result.ts).toBe("2024-01-01T00:00:00Z");
      expect(result.finish_reason).toBeUndefined();
    });

    it("should convert system message", () => {
      const legacy: LegacyChatMessage = {
        role: "system",
        content: "You are a helpful assistant.",
      };

      const result = toOTelMessage(legacy);

      expect(result.role).toBe("system");
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]).toEqual({
        type: "text",
        content: "You are a helpful assistant.",
      });
    });

    it("should convert assistant text message", () => {
      const legacy: LegacyChatMessage = {
        role: "assistant",
        content: "Here is my response.",
      };

      const result = toOTelMessage(legacy);

      expect(result.role).toBe("assistant");
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]).toEqual({
        type: "text",
        content: "Here is my response.",
      });
      expect(result.finish_reason).toBe("stop");
    });

    it("should convert assistant message with reasoning", () => {
      const legacy: LegacyChatMessage = {
        role: "assistant",
        content: "The answer is 42.",
        reasoning: "Let me think about this...",
      };

      const result = toOTelMessage(legacy);

      expect(result.role).toBe("assistant");
      expect(result.parts).toHaveLength(2);
      expect(result.parts[0]).toEqual({
        type: "reasoning",
        content: "Let me think about this...",
      });
      expect(result.parts[1]).toEqual({
        type: "text",
        content: "The answer is 42.",
      });
      expect(result.finish_reason).toBe("stop");
    });

    it("should convert assistant message with tool calls", () => {
      const legacy: LegacyChatMessage = {
        role: "assistant",
        toolCalls: [
          { id: "call_1", name: "get_weather", args: { city: "Paris" } },
          { id: "call_2", name: "get_time", args: { timezone: "UTC" } },
        ],
      };

      const result = toOTelMessage(legacy);

      expect(result.role).toBe("assistant");
      expect(result.parts).toHaveLength(2);
      expect(result.parts[0]).toEqual({
        type: "tool_call",
        id: "call_1",
        name: "get_weather",
        arguments: { city: "Paris" },
      });
      expect(result.parts[1]).toEqual({
        type: "tool_call",
        id: "call_2",
        name: "get_time",
        arguments: { timezone: "UTC" },
      });
      expect(result.finish_reason).toBe("tool_call");
    });

    it("should convert assistant tool calls with reasoning", () => {
      const legacy: LegacyChatMessage = {
        role: "assistant",
        toolCalls: [{ id: "call_1", name: "search", args: { query: "test" } }],
        reasoning: "I need to search for this.",
      };

      const result = toOTelMessage(legacy);

      expect(result.parts).toHaveLength(2);
      expect(result.parts[0]).toEqual({
        type: "reasoning",
        content: "I need to search for this.",
      });
      expect(result.parts[1].type).toBe("tool_call");
      expect(result.finish_reason).toBe("tool_call");
    });

    it("should convert tool result message", () => {
      const legacy: LegacyChatMessage = {
        role: "tool",
        toolCallId: "call_1",
        content: '{"temperature": 22, "unit": "celsius"}',
      };

      const result = toOTelMessage(legacy);

      expect(result.role).toBe("tool");
      expect(result.parts).toHaveLength(1);
      expect(result.parts[0]).toEqual({
        type: "tool_call_response",
        id: "call_1",
        response: '{"temperature": 22, "unit": "celsius"}',
      });
    });
  });

  describe("toOTelMessages", () => {
    it("should convert array of messages", () => {
      const legacy: LegacyChatMessage[] = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi!" },
        { role: "assistant", content: "Hello!" },
      ];

      const result = toOTelMessages(legacy);

      expect(result).toHaveLength(3);
      expect(result[0].role).toBe("system");
      expect(result[1].role).toBe("user");
      expect(result[2].role).toBe("assistant");
    });
  });

  describe("fromOTelMessage", () => {
    it("should convert user message back to legacy", () => {
      const otel: OTelMessage = {
        role: "user",
        parts: [{ type: "text", content: "Hello!" }],
        ts: "2024-01-01T00:00:00Z",
      };

      const result = fromOTelMessage(otel);

      expect(result.role).toBe("user");
      expect(result).toHaveProperty("content", "Hello!");
      expect(result.ts).toBe("2024-01-01T00:00:00Z");
    });

    it("should convert system message back to legacy", () => {
      const otel: OTelMessage = {
        role: "system",
        parts: [{ type: "text", content: "System prompt." }],
      };

      const result = fromOTelMessage(otel);

      expect(result.role).toBe("system");
      expect(result).toHaveProperty("content", "System prompt.");
    });

    it("should convert assistant text message back to legacy", () => {
      const otel: OTelMessage = {
        role: "assistant",
        parts: [{ type: "text", content: "Response text." }],
        finish_reason: "stop",
      };

      const result = fromOTelMessage(otel);

      expect(result.role).toBe("assistant");
      expect(result).toHaveProperty("content", "Response text.");
    });

    it("should convert assistant message with reasoning back to legacy", () => {
      const otel: OTelMessage = {
        role: "assistant",
        parts: [
          { type: "reasoning", content: "Thinking..." },
          { type: "text", content: "Answer." },
        ],
        finish_reason: "stop",
      };

      const result = fromOTelMessage(otel);

      expect(result.role).toBe("assistant");
      expect(result).toHaveProperty("content", "Answer.");
      expect(result).toHaveProperty("reasoning", "Thinking...");
    });

    it("should convert assistant tool calls back to legacy", () => {
      const otel: OTelMessage = {
        role: "assistant",
        parts: [
          { type: "tool_call", id: "call_1", name: "search", arguments: { q: "test" } },
        ],
        finish_reason: "tool_call",
      };

      const result = fromOTelMessage(otel);

      expect(result.role).toBe("assistant");
      expect(result).toHaveProperty("toolCalls");
      const resultWithToolCalls = result as LegacyChatMessage & { toolCalls: Array<{ id: string; name: string; args: unknown }> };
      expect(resultWithToolCalls.toolCalls).toHaveLength(1);
      expect(resultWithToolCalls.toolCalls[0]).toEqual({ id: "call_1", name: "search", args: { q: "test" } });
    });

    it("should convert tool response back to legacy", () => {
      const otel: OTelMessage = {
        role: "tool",
        parts: [{ type: "tool_call_response", id: "call_1", response: "result" }],
      };

      const result = fromOTelMessage(otel);

      expect(result.role).toBe("tool");
      expect(result).toHaveProperty("toolCallId", "call_1");
      expect(result).toHaveProperty("content", "result");
    });

    it("should handle tool response with object response", () => {
      const otel: OTelMessage = {
        role: "tool",
        parts: [
          { type: "tool_call_response", id: "call_1", response: { data: "value" } },
        ],
      };

      const result = fromOTelMessage(otel);

      expect(result.role).toBe("tool");
      expect(result).toHaveProperty("content", '{"data":"value"}');
    });

    it("should merge multiple text parts", () => {
      const otel: OTelMessage = {
        role: "user",
        parts: [
          { type: "text", content: "Part 1." },
          { type: "text", content: "Part 2." },
        ],
      };

      const result = fromOTelMessage(otel);

      expect(result).toHaveProperty("content", "Part 1.\nPart 2.");
    });
  });

  describe("fromOTelMessages", () => {
    it("should convert array of OTel messages to legacy", () => {
      const otel: OTelMessage[] = [
        { role: "user", parts: [{ type: "text", content: "Hi" }] },
        { role: "assistant", parts: [{ type: "text", content: "Hello" }] },
      ];

      const result = fromOTelMessages(otel);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("content", "Hi");
      expect(result[1]).toHaveProperty("content", "Hello");
    });
  });

  describe("Round-trip conversions", () => {
    it("should preserve user message through round-trip", () => {
      const original: LegacyChatMessage = {
        role: "user",
        content: "Test message",
        ts: "2024-01-01T00:00:00Z",
      };

      const roundTrip = fromOTelMessage(toOTelMessage(original));

      expect(roundTrip).toEqual(original);
    });

    it("should preserve assistant text message through round-trip", () => {
      const original: LegacyChatMessage = {
        role: "assistant",
        content: "Response",
        reasoning: "Thinking",
        ts: "2024-01-01T00:00:00Z",
      };

      const roundTrip = fromOTelMessage(toOTelMessage(original));

      expect(roundTrip).toEqual(original);
    });

    it("should preserve assistant tool calls through round-trip", () => {
      const original: LegacyChatMessage = {
        role: "assistant",
        toolCalls: [{ id: "call_1", name: "test", args: { x: 1 } }],
        ts: "2024-01-01T00:00:00Z",
      };

      const roundTrip = fromOTelMessage(toOTelMessage(original));

      expect(roundTrip).toEqual(original);
    });

    it("should preserve tool result through round-trip", () => {
      const original: LegacyChatMessage = {
        role: "tool",
        toolCallId: "call_1",
        content: "result",
        ts: "2024-01-01T00:00:00Z",
      };

      const roundTrip = fromOTelMessage(toOTelMessage(original));

      expect(roundTrip).toEqual(original);
    });
  });
});

describe("Part Extraction Helpers", () => {
  describe("extractTextContent", () => {
    it("should extract single text part", () => {
      const parts: MessagePart[] = [{ type: "text", content: "Hello" }];
      expect(extractTextContent(parts)).toBe("Hello");
    });

    it("should join multiple text parts", () => {
      const parts: MessagePart[] = [
        { type: "text", content: "Line 1" },
        { type: "text", content: "Line 2" },
      ];
      expect(extractTextContent(parts)).toBe("Line 1\nLine 2");
    });

    it("should ignore non-text parts", () => {
      const parts: MessagePart[] = [
        { type: "reasoning", content: "Thinking" },
        { type: "text", content: "Answer" },
      ];
      expect(extractTextContent(parts)).toBe("Answer");
    });

    it("should return empty string for no text parts", () => {
      const parts: MessagePart[] = [
        { type: "tool_call", id: "1", name: "test", arguments: {} },
      ];
      expect(extractTextContent(parts)).toBe("");
    });
  });

  describe("extractReasoning", () => {
    it("should extract reasoning content", () => {
      const parts: MessagePart[] = [
        { type: "reasoning", content: "Step 1" },
        { type: "text", content: "Answer" },
      ];
      expect(extractReasoning(parts)).toBe("Step 1");
    });

    it("should join multiple reasoning parts", () => {
      const parts: MessagePart[] = [
        { type: "reasoning", content: "Step 1" },
        { type: "reasoning", content: "Step 2" },
      ];
      expect(extractReasoning(parts)).toBe("Step 1\nStep 2");
    });

    it("should return undefined for no reasoning", () => {
      const parts: MessagePart[] = [{ type: "text", content: "Answer" }];
      expect(extractReasoning(parts)).toBeUndefined();
    });
  });

  describe("extractToolCalls", () => {
    it("should extract tool calls", () => {
      const parts: MessagePart[] = [
        { type: "tool_call", id: "1", name: "search", arguments: { q: "test" } },
        { type: "tool_call", id: "2", name: "fetch", arguments: { url: "http://x" } },
      ];

      const result = extractToolCalls(parts);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: "1", name: "search", args: { q: "test" } });
      expect(result[1]).toEqual({ id: "2", name: "fetch", args: { url: "http://x" } });
    });

    it("should return empty array for no tool calls", () => {
      const parts: MessagePart[] = [{ type: "text", content: "Hello" }];
      expect(extractToolCalls(parts)).toEqual([]);
    });
  });

  describe("extractToolResponse", () => {
    it("should extract tool response", () => {
      const parts: MessagePart[] = [
        { type: "tool_call_response", id: "call_1", response: "result" },
      ];

      const result = extractToolResponse(parts);

      expect(result).toEqual({ id: "call_1", content: "result" });
    });

    it("should stringify object response", () => {
      const parts: MessagePart[] = [
        { type: "tool_call_response", id: "call_1", response: { key: "value" } },
      ];

      const result = extractToolResponse(parts);

      expect(result.content).toBe('{"key":"value"}');
    });

    it("should return empty for no tool response", () => {
      const parts: MessagePart[] = [{ type: "text", content: "Hello" }];

      const result = extractToolResponse(parts);

      expect(result).toEqual({ id: "", content: "" });
    });
  });
});

describe("Part Construction Helpers", () => {
  it("textPart should create text part", () => {
    expect(textPart("Hello")).toEqual({ type: "text", content: "Hello" });
  });

  it("toolCallPart should create tool call part", () => {
    expect(toolCallPart("1", "search", { q: "test" })).toEqual({
      type: "tool_call",
      id: "1",
      name: "search",
      arguments: { q: "test" },
    });
  });

  it("toolResponsePart should create tool response part", () => {
    expect(toolResponsePart("1", "result")).toEqual({
      type: "tool_call_response",
      id: "1",
      response: "result",
    });
  });

  it("reasoningPart should create reasoning part", () => {
    expect(reasoningPart("Thinking")).toEqual({
      type: "reasoning",
      content: "Thinking",
    });
  });
});

describe("Message Construction Helpers", () => {
  describe("userMessage", () => {
    it("should create user message", () => {
      const msg = userMessage("Hello");
      expect(msg.role).toBe("user");
      expect(msg.parts).toEqual([{ type: "text", content: "Hello" }]);
    });

    it("should include timestamp if provided", () => {
      const msg = userMessage("Hello", "2024-01-01T00:00:00Z");
      expect(msg.ts).toBe("2024-01-01T00:00:00Z");
    });
  });

  describe("systemMessage", () => {
    it("should create system message", () => {
      const msg = systemMessage("You are helpful.");
      expect(msg.role).toBe("system");
      expect(msg.parts).toEqual([{ type: "text", content: "You are helpful." }]);
    });
  });

  describe("assistantMessage", () => {
    it("should create assistant message", () => {
      const msg = assistantMessage("Response");
      expect(msg.role).toBe("assistant");
      expect(msg.parts).toEqual([{ type: "text", content: "Response" }]);
      expect(msg.finish_reason).toBe("stop");
    });

    it("should include reasoning if provided", () => {
      const msg = assistantMessage("Response", { reasoning: "Thinking" });
      expect(msg.parts).toHaveLength(2);
      expect(msg.parts[0]).toEqual({ type: "reasoning", content: "Thinking" });
      expect(msg.parts[1]).toEqual({ type: "text", content: "Response" });
    });
  });

  describe("assistantToolCallMessage", () => {
    it("should create assistant tool call message", () => {
      const msg = assistantToolCallMessage([
        { id: "1", name: "search", args: { q: "test" } },
      ]);
      expect(msg.role).toBe("assistant");
      expect(msg.parts).toEqual([
        { type: "tool_call", id: "1", name: "search", arguments: { q: "test" } },
      ]);
      expect(msg.finish_reason).toBe("tool_call");
    });

    it("should include reasoning if provided", () => {
      const msg = assistantToolCallMessage(
        [{ id: "1", name: "search", args: {} }],
        { reasoning: "Thinking" }
      );
      expect(msg.parts).toHaveLength(2);
      expect(msg.parts[0].type).toBe("reasoning");
    });
  });

  describe("toolMessage", () => {
    it("should create tool message", () => {
      const msg = toolMessage("call_1", "result");
      expect(msg.role).toBe("tool");
      expect(msg.parts).toEqual([
        { type: "tool_call_response", id: "call_1", response: "result" },
      ]);
    });
  });
});

describe("Validation Helpers", () => {
  describe("hasToolCalls", () => {
    it("should return true for message with tool calls", () => {
      const msg: OTelMessage = {
        role: "assistant",
        parts: [{ type: "tool_call", id: "1", name: "test", arguments: {} }],
      };
      expect(hasToolCalls(msg)).toBe(true);
    });

    it("should return false for message without tool calls", () => {
      const msg: OTelMessage = {
        role: "assistant",
        parts: [{ type: "text", content: "Hello" }],
      };
      expect(hasToolCalls(msg)).toBe(false);
    });
  });

  describe("hasTextContent", () => {
    it("should return true for message with text", () => {
      const msg: OTelMessage = {
        role: "user",
        parts: [{ type: "text", content: "Hello" }],
      };
      expect(hasTextContent(msg)).toBe(true);
    });

    it("should return false for message without text", () => {
      const msg: OTelMessage = {
        role: "assistant",
        parts: [{ type: "tool_call", id: "1", name: "test", arguments: {} }],
      };
      expect(hasTextContent(msg)).toBe(false);
    });
  });

  describe("isToolResponse", () => {
    it("should return true for tool role", () => {
      const msg: OTelMessage = {
        role: "tool",
        parts: [{ type: "tool_call_response", id: "1", response: "result" }],
      };
      expect(isToolResponse(msg)).toBe(true);
    });

    it("should return false for non-tool role", () => {
      const msg: OTelMessage = {
        role: "assistant",
        parts: [{ type: "text", content: "Hello" }],
      };
      expect(isToolResponse(msg)).toBe(false);
    });
  });

  describe("getToolCallCount", () => {
    it("should count tool calls", () => {
      const msg: OTelMessage = {
        role: "assistant",
        parts: [
          { type: "tool_call", id: "1", name: "a", arguments: {} },
          { type: "tool_call", id: "2", name: "b", arguments: {} },
          { type: "text", content: "Hello" },
        ],
      };
      expect(getToolCallCount(msg)).toBe(2);
    });

    it("should return 0 for no tool calls", () => {
      const msg: OTelMessage = {
        role: "user",
        parts: [{ type: "text", content: "Hello" }],
      };
      expect(getToolCallCount(msg)).toBe(0);
    });
  });
});
