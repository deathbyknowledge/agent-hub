import { describe, expect, it } from "vitest";
import {
  applyEvent,
  projectEvents,
  projectEventsUntil,
  projectFromSnapshot,
  initialProjection,
  createSnapshot,
  shouldSnapshot,
  getMessagesLegacy,
  type AgentProjection,
} from "../runtime/agent/projections";
import { AgentEventType, type AgentEvent } from "../runtime/events";
import type { OTelMessage } from "../runtime/types";

// Helper to create events with sequence numbers
function createEvent(
  seq: number,
  type: AgentEventType | string,
  data: Record<string, unknown>
): AgentEvent {
  return {
    seq,
    type,
    data,
    ts: new Date().toISOString(),
  } as AgentEvent;
}

describe("Event Projections", () => {
  describe("initialProjection", () => {
    it("should have correct default values", () => {
      expect(initialProjection.messages).toEqual([]);
      expect(initialProjection.status).toBe("registered");
      expect(initialProjection.step).toBe(0);
      expect(initialProjection.pendingToolCalls).toEqual([]);
      expect(initialProjection.totalInputTokens).toBe(0);
      expect(initialProjection.totalOutputTokens).toBe(0);
      expect(initialProjection.inferenceCount).toBe(0);
    });
  });

  describe("applyEvent - Agent Lifecycle", () => {
    it("should handle AGENT_INVOKED", () => {
      const event = createEvent(1, AgentEventType.AGENT_INVOKED, {});
      const state = applyEvent(initialProjection, event);
      expect(state.status).toBe("running");
    });

    it("should handle AGENT_STEP", () => {
      const event = createEvent(1, AgentEventType.AGENT_STEP, { step: 5 });
      const state = applyEvent(initialProjection, event);
      expect(state.step).toBe(5);
    });

    it("should handle AGENT_PAUSED", () => {
      const event = createEvent(1, AgentEventType.AGENT_PAUSED, { reason: "hitl" });
      const state = applyEvent({ ...initialProjection, status: "running" }, event);
      expect(state.status).toBe("paused");
    });

    it("should handle AGENT_RESUMED", () => {
      const event = createEvent(1, AgentEventType.AGENT_RESUMED, {});
      const state = applyEvent({ ...initialProjection, status: "paused" }, event);
      expect(state.status).toBe("running");
    });

    it("should handle AGENT_COMPLETED", () => {
      const event = createEvent(1, AgentEventType.AGENT_COMPLETED, { result: "done" });
      const state = applyEvent(
        { ...initialProjection, status: "running", pendingToolCalls: [{ id: "1", name: "test", args: {} }] },
        event
      );
      expect(state.status).toBe("completed");
      expect(state.pendingToolCalls).toEqual([]);
    });

    it("should handle AGENT_ERROR", () => {
      const event = createEvent(1, AgentEventType.AGENT_ERROR, {
        "error.type": "runtime_error",
        "error.message": "Something went wrong",
      });
      const state = applyEvent(initialProjection, event);
      expect(state.status).toBe("error");
      expect(state.lastError).toEqual({
        type: "runtime_error",
        message: "Something went wrong",
      });
    });

    it("should handle AGENT_CANCELED", () => {
      const event = createEvent(1, AgentEventType.AGENT_CANCELED, {});
      const state = applyEvent(
        { ...initialProjection, pendingToolCalls: [{ id: "1", name: "test", args: {} }] },
        event
      );
      expect(state.status).toBe("canceled");
      expect(state.pendingToolCalls).toEqual([]);
    });
  });

  describe("applyEvent - USER_MESSAGE", () => {
    it("should append user messages", () => {
      const userMessage: OTelMessage = {
        role: "user",
        parts: [{ type: "text", content: "Hello!" }],
      };

      const event = createEvent(1, AgentEventType.USER_MESSAGE, {
        "gen_ai.content.messages": [userMessage],
      });

      const state = applyEvent(initialProjection, event);

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual(userMessage);
    });

    it("should append multiple user messages", () => {
      const messages: OTelMessage[] = [
        { role: "user", parts: [{ type: "text", content: "First" }] },
        { role: "user", parts: [{ type: "text", content: "Second" }] },
      ];

      const event = createEvent(1, AgentEventType.USER_MESSAGE, {
        "gen_ai.content.messages": messages,
      });

      const state = applyEvent(initialProjection, event);

      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].role).toBe("user");
      expect(state.messages[1].role).toBe("user");
    });
  });

  describe("applyEvent - INFERENCE_DETAILS", () => {
    it("should append output messages", () => {
      const outputMessage: OTelMessage = {
        role: "assistant",
        parts: [{ type: "text", content: "Hello!" }],
        finish_reason: "stop",
      };

      const event = createEvent(1, AgentEventType.INFERENCE_DETAILS, {
        "gen_ai.operation.name": "chat",
        "gen_ai.output.messages": [outputMessage],
        "gen_ai.usage.input_tokens": 10,
        "gen_ai.usage.output_tokens": 5,
      });

      const state = applyEvent(initialProjection, event);

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual(outputMessage);
      expect(state.totalInputTokens).toBe(10);
      expect(state.totalOutputTokens).toBe(5);
      expect(state.inferenceCount).toBe(1);
    });

    it("should only append output (user messages come from USER_MESSAGE event)", () => {
      // User message already in state from USER_MESSAGE event
      const userMessage: OTelMessage = {
        role: "user",
        parts: [{ type: "text", content: "What is the weather?" }],
      };
      const stateWithUser: AgentProjection = {
        ...initialProjection,
        messages: [userMessage],
      };

      const assistantMessage: OTelMessage = {
        role: "assistant",
        parts: [{ type: "text", content: "The weather is sunny!" }],
        finish_reason: "stop",
      };

      const event = createEvent(2, AgentEventType.INFERENCE_DETAILS, {
        "gen_ai.operation.name": "chat",
        "gen_ai.input.messages": [userMessage], // Input context (ignored)
        "gen_ai.output.messages": [assistantMessage],
      });

      const state = applyEvent(stateWithUser, event);

      // Should have: user (from previous) + assistant (from output) = 2 messages
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].role).toBe("user");
      expect(state.messages[1].role).toBe("assistant");
    });

    it("should extract pending tool calls from output", () => {
      const outputMessage: OTelMessage = {
        role: "assistant",
        parts: [
          { type: "tool_call", id: "call_1", name: "search", arguments: { q: "test" } },
          { type: "tool_call", id: "call_2", name: "fetch", arguments: { url: "http://x" } },
        ],
        finish_reason: "tool_call",
      };

      const event = createEvent(1, AgentEventType.INFERENCE_DETAILS, {
        "gen_ai.operation.name": "chat",
        "gen_ai.output.messages": [outputMessage],
      });

      const state = applyEvent(initialProjection, event);

      expect(state.pendingToolCalls).toHaveLength(2);
      expect(state.pendingToolCalls[0]).toEqual({ id: "call_1", name: "search", args: { q: "test" } });
      expect(state.pendingToolCalls[1]).toEqual({ id: "call_2", name: "fetch", args: { url: "http://x" } });
    });

    it("should accumulate tokens across multiple inferences", () => {
      let state = initialProjection;

      state = applyEvent(state, createEvent(1, AgentEventType.INFERENCE_DETAILS, {
        "gen_ai.operation.name": "chat",
        "gen_ai.output.messages": [{ role: "assistant", parts: [{ type: "text", content: "Hi" }] }],
        "gen_ai.usage.input_tokens": 10,
        "gen_ai.usage.output_tokens": 5,
      }));

      state = applyEvent(state, createEvent(2, AgentEventType.INFERENCE_DETAILS, {
        "gen_ai.operation.name": "chat",
        "gen_ai.output.messages": [{ role: "assistant", parts: [{ type: "text", content: "Bye" }] }],
        "gen_ai.usage.input_tokens": 20,
        "gen_ai.usage.output_tokens": 10,
      }));

      expect(state.totalInputTokens).toBe(30);
      expect(state.totalOutputTokens).toBe(15);
      expect(state.inferenceCount).toBe(2);
      expect(state.messages).toHaveLength(2);
    });
  });

  describe("applyEvent - Tool Events", () => {
    it("should handle TOOL_FINISH", () => {
      const stateWithPending: AgentProjection = {
        ...initialProjection,
        pendingToolCalls: [
          { id: "call_1", name: "search", args: {} },
          { id: "call_2", name: "fetch", args: {} },
        ],
      };

      const event = createEvent(1, AgentEventType.TOOL_FINISH, {
        "gen_ai.tool.name": "search",
        "gen_ai.tool.call.id": "call_1",
        "gen_ai.tool.response": { results: ["a", "b"] },
      });

      const state = applyEvent(stateWithPending, event);

      // Should remove completed tool from pending
      expect(state.pendingToolCalls).toHaveLength(1);
      expect(state.pendingToolCalls[0].id).toBe("call_2");

      // Should add tool result message
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe("tool");
      expect(state.messages[0].parts[0]).toEqual({
        type: "tool_call_response",
        id: "call_1",
        response: { results: ["a", "b"] },
      });
    });

    it("should handle TOOL_ERROR", () => {
      const stateWithPending: AgentProjection = {
        ...initialProjection,
        pendingToolCalls: [{ id: "call_1", name: "search", args: {} }],
      };

      const event = createEvent(1, AgentEventType.TOOL_ERROR, {
        "gen_ai.tool.name": "search",
        "gen_ai.tool.call.id": "call_1",
        "error.type": "timeout",
        "error.message": "Request timed out",
      });

      const state = applyEvent(stateWithPending, event);

      // Should remove errored tool from pending
      expect(state.pendingToolCalls).toHaveLength(0);

      // Should add error message
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe("tool");
      expect(state.messages[0].parts[0]).toEqual({
        type: "tool_call_response",
        id: "call_1",
        response: "Error: Request timed out",
      });
    });
  });

  describe("applyEvent - Unknown Events", () => {
    it("should ignore unknown event types", () => {
      const event = createEvent(1, "unknown.event.type", { foo: "bar" });
      const state = applyEvent(initialProjection, event);
      expect(state).toEqual(initialProjection);
    });

    it("should ignore CHAT_START events", () => {
      const event = createEvent(1, AgentEventType.CHAT_START, { "gen_ai.request.model": "gpt-4" });
      const state = applyEvent(initialProjection, event);
      expect(state).toEqual(initialProjection);
    });
  });

  describe("projectEvents", () => {
    it("should project empty events to initial state", () => {
      const state = projectEvents([]);
      expect(state).toEqual(initialProjection);
    });

    it("should project a sequence of events", () => {
      const events: AgentEvent[] = [
        createEvent(1, AgentEventType.AGENT_INVOKED, {}),
        createEvent(2, AgentEventType.AGENT_STEP, { step: 1 }),
        createEvent(3, AgentEventType.INFERENCE_DETAILS, {
          "gen_ai.operation.name": "chat",
          "gen_ai.output.messages": [{
            role: "assistant",
            parts: [{ type: "text", content: "Hello!" }],
          }],
          "gen_ai.usage.input_tokens": 10,
          "gen_ai.usage.output_tokens": 5,
        }),
        createEvent(4, AgentEventType.AGENT_COMPLETED, { result: "Hello!" }),
      ];

      const state = projectEvents(events);

      expect(state.status).toBe("completed");
      expect(state.step).toBe(1);
      expect(state.messages).toHaveLength(1);
      expect(state.totalInputTokens).toBe(10);
      expect(state.totalOutputTokens).toBe(5);
    });

    it("should use custom initial state", () => {
      const customInitial: AgentProjection = {
        ...initialProjection,
        step: 10,
        totalInputTokens: 100,
      };

      const events: AgentEvent[] = [
        createEvent(1, AgentEventType.AGENT_STEP, { step: 11 }),
      ];

      const state = projectEvents(events, customInitial);

      expect(state.step).toBe(11);
      expect(state.totalInputTokens).toBe(100); // Preserved from initial
    });
  });

  describe("projectEventsUntil", () => {
    it("should project events up to sequence number", () => {
      const events: AgentEvent[] = [
        createEvent(1, AgentEventType.AGENT_INVOKED, {}),
        createEvent(2, AgentEventType.AGENT_STEP, { step: 1 }),
        createEvent(3, AgentEventType.AGENT_STEP, { step: 2 }),
        createEvent(4, AgentEventType.AGENT_COMPLETED, {}),
      ];

      // Project only up to seq 2
      const state = projectEventsUntil(events, 2);

      expect(state.status).toBe("running"); // Not completed yet
      expect(state.step).toBe(1);
    });

    it("should include event at exact sequence number", () => {
      const events: AgentEvent[] = [
        createEvent(1, AgentEventType.AGENT_INVOKED, {}),
        createEvent(2, AgentEventType.AGENT_COMPLETED, {}),
      ];

      const state = projectEventsUntil(events, 2);
      expect(state.status).toBe("completed");
    });
  });

  describe("projectFromSnapshot", () => {
    it("should project from snapshot", () => {
      const snapshot: AgentProjection = {
        ...initialProjection,
        status: "running",
        step: 5,
        messages: [{ role: "assistant", parts: [{ type: "text", content: "Previous" }] }],
        totalInputTokens: 50,
        totalOutputTokens: 25,
        inferenceCount: 2,
      };

      const events: AgentEvent[] = [
        createEvent(1, AgentEventType.AGENT_INVOKED, {}), // Before snapshot, should be ignored
        createEvent(5, AgentEventType.AGENT_STEP, { step: 5 }), // At snapshot, should be ignored
        createEvent(6, AgentEventType.AGENT_STEP, { step: 6 }), // After snapshot
        createEvent(7, AgentEventType.AGENT_COMPLETED, {}),
      ];

      const state = projectFromSnapshot(snapshot, 5, events);

      expect(state.status).toBe("completed");
      expect(state.step).toBe(6);
      expect(state.messages).toHaveLength(1); // From snapshot
      expect(state.totalInputTokens).toBe(50); // From snapshot
    });
  });

  describe("Snapshot Utilities", () => {
    describe("createSnapshot", () => {
      it("should create a snapshot", () => {
        const state: AgentProjection = {
          ...initialProjection,
          step: 10,
          messages: [{ role: "user", parts: [{ type: "text", content: "Hi" }] }],
        };

        const snapshot = createSnapshot(state, 42);

        expect(snapshot.lastEventSeq).toBe(42);
        expect(snapshot.state).toEqual(state);
        expect(snapshot.createdAt).toBeDefined();
      });
    });

    describe("shouldSnapshot", () => {
      it("should return true when threshold exceeded", () => {
        expect(shouldSnapshot(100)).toBe(true);
        expect(shouldSnapshot(150)).toBe(true);
      });

      it("should return false when below threshold", () => {
        expect(shouldSnapshot(50)).toBe(false);
        expect(shouldSnapshot(99)).toBe(false);
      });

      it("should use custom threshold", () => {
        expect(shouldSnapshot(50, 50)).toBe(true);
        expect(shouldSnapshot(49, 50)).toBe(false);
      });
    });
  });

  describe("getMessagesLegacy", () => {
    it("should convert OTel messages to legacy format", () => {
      const projection: AgentProjection = {
        ...initialProjection,
        messages: [
          { role: "user", parts: [{ type: "text", content: "Hello" }] },
          { role: "assistant", parts: [{ type: "text", content: "Hi there!" }] },
        ],
      };

      const legacy = getMessagesLegacy(projection);

      expect(legacy).toHaveLength(2);
      expect(legacy[0]).toHaveProperty("content", "Hello");
      expect(legacy[1]).toHaveProperty("content", "Hi there!");
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle full conversation: user -> tool call -> result -> completion", () => {
      const events: AgentEvent[] = [
        createEvent(1, AgentEventType.AGENT_INVOKED, {}),
        // User message
        createEvent(2, AgentEventType.USER_MESSAGE, {
          "gen_ai.content.messages": [{ role: "user", parts: [{ type: "text", content: "What's the weather?" }] }],
        }),
        createEvent(3, AgentEventType.AGENT_STEP, { step: 1 }),
        // First inference - tool call
        createEvent(4, AgentEventType.INFERENCE_DETAILS, {
          "gen_ai.operation.name": "chat",
          "gen_ai.output.messages": [{
            role: "assistant",
            parts: [{ type: "tool_call", id: "call_1", name: "search", arguments: { q: "weather" } }],
            finish_reason: "tool_call",
          }],
          "gen_ai.usage.input_tokens": 20,
          "gen_ai.usage.output_tokens": 10,
        }),
        // Tool execution
        createEvent(5, AgentEventType.TOOL_FINISH, {
          "gen_ai.tool.name": "search",
          "gen_ai.tool.call.id": "call_1",
          "gen_ai.tool.response": "Sunny, 72F",
        }),
        createEvent(6, AgentEventType.AGENT_STEP, { step: 2 }),
        // Second inference - final response
        createEvent(7, AgentEventType.INFERENCE_DETAILS, {
          "gen_ai.operation.name": "chat",
          "gen_ai.output.messages": [{
            role: "assistant",
            parts: [{ type: "text", content: "The weather is sunny, 72F!" }],
            finish_reason: "stop",
          }],
          "gen_ai.usage.input_tokens": 50,
          "gen_ai.usage.output_tokens": 15,
        }),
        createEvent(8, AgentEventType.AGENT_COMPLETED, { result: "The weather is sunny, 72F!" }),
      ];

      const state = projectEvents(events);

      expect(state.status).toBe("completed");
      expect(state.step).toBe(2);
      // user + tool_call + tool_result + final = 4 messages
      expect(state.messages).toHaveLength(4);
      expect(state.messages[0].role).toBe("user");
      expect(state.messages[1].role).toBe("assistant"); // tool call
      expect(state.messages[2].role).toBe("tool"); // tool result
      expect(state.messages[3].role).toBe("assistant"); // final response
      expect(state.pendingToolCalls).toEqual([]);
      expect(state.totalInputTokens).toBe(70);
      expect(state.totalOutputTokens).toBe(25);
      expect(state.inferenceCount).toBe(2);
    });

    it("should handle multiple parallel tool calls", () => {
      const events: AgentEvent[] = [
        createEvent(1, AgentEventType.AGENT_INVOKED, {}),
        createEvent(2, AgentEventType.INFERENCE_DETAILS, {
          "gen_ai.operation.name": "chat",
          "gen_ai.output.messages": [{
            role: "assistant",
            parts: [
              { type: "tool_call", id: "call_1", name: "search", arguments: {} },
              { type: "tool_call", id: "call_2", name: "fetch", arguments: {} },
              { type: "tool_call", id: "call_3", name: "compute", arguments: {} },
            ],
            finish_reason: "tool_call",
          }],
        }),
        createEvent(3, AgentEventType.TOOL_FINISH, {
          "gen_ai.tool.name": "search",
          "gen_ai.tool.call.id": "call_1",
          "gen_ai.tool.response": "result1",
        }),
        createEvent(4, AgentEventType.TOOL_ERROR, {
          "gen_ai.tool.name": "fetch",
          "gen_ai.tool.call.id": "call_2",
          "error.type": "network_error",
          "error.message": "Connection failed",
        }),
        createEvent(5, AgentEventType.TOOL_FINISH, {
          "gen_ai.tool.name": "compute",
          "gen_ai.tool.call.id": "call_3",
          "gen_ai.tool.response": "result3",
        }),
      ];

      const state = projectEvents(events);

      expect(state.pendingToolCalls).toEqual([]); // All resolved
      expect(state.messages).toHaveLength(4); // 1 assistant + 3 tool results
      
      // Check tool results
      const toolMessages = state.messages.filter(m => m.role === "tool");
      expect(toolMessages).toHaveLength(3);
    });

    it("should time-travel to middle of conversation", () => {
      const events: AgentEvent[] = [
        createEvent(1, AgentEventType.AGENT_INVOKED, {}),
        createEvent(2, AgentEventType.INFERENCE_DETAILS, {
          "gen_ai.operation.name": "chat",
          "gen_ai.output.messages": [{ role: "assistant", parts: [{ type: "text", content: "First" }] }],
        }),
        createEvent(3, AgentEventType.INFERENCE_DETAILS, {
          "gen_ai.operation.name": "chat",
          "gen_ai.output.messages": [{ role: "assistant", parts: [{ type: "text", content: "Second" }] }],
        }),
        createEvent(4, AgentEventType.INFERENCE_DETAILS, {
          "gen_ai.operation.name": "chat",
          "gen_ai.output.messages": [{ role: "assistant", parts: [{ type: "text", content: "Third" }] }],
        }),
        createEvent(5, AgentEventType.AGENT_COMPLETED, {}),
      ];

      // Time travel to seq 3
      const stateAtSeq3 = projectEventsUntil(events, 3);
      expect(stateAtSeq3.messages).toHaveLength(2);
      expect(stateAtSeq3.status).toBe("running");

      // Full projection
      const finalState = projectEvents(events);
      expect(finalState.messages).toHaveLength(3);
      expect(finalState.status).toBe("completed");
    });
  });
});
