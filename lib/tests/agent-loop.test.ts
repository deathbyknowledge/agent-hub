import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { testProvider, getAgentByName, type Env } from "./worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

/**
 * Helper to wait for agent to reach a specific status.
 * Polls the agent state until the status matches or timeout.
 */
async function waitForStatus(
  agentStub: { fetch: (req: Request) => Promise<Response> },
  expectedStatus: string,
  timeoutMs = 5000,
  pollMs = 50
): Promise<{ state: Record<string, unknown>; run: { status: string } }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await agentStub.fetch(new Request("http://do/state"));
    const data = await res.json() as { state: Record<string, unknown>; run: { status: string } };
    if (data.run.status === expectedStatus) {
      return data;
    }
    // If status is an error state, return immediately
    if (["error", "canceled"].includes(data.run.status)) {
      return data;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timeout waiting for status "${expectedStatus}"`);
}

/**
 * Helper to spawn an agent and return the agent stub.
 */
async function spawnAgent(agencyName: string): Promise<{
  agentId: string;
  agentStub: { fetch: (req: Request) => Promise<Response> };
  agencyStub: { fetch: (req: Request | string) => Promise<Response> };
}> {
  const agencyStub = await getAgentByName(env.AGENCY, agencyName);

  const spawnRes = await agencyStub.fetch(
    new Request("http://do/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentType: "test-agent" }),
    })
  );

  expect(spawnRes.ok).toBe(true);
  const { id: agentId } = await spawnRes.json() as { id: string };
  const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

  return { agentId, agentStub, agencyStub };
}

describe("Agent Loop Integration", () => {
  beforeEach(() => {
    // Reset the test provider before each test
    testProvider.reset();
  });

  describe("Simple completion (no tools)", () => {
    it("should complete when model returns text without tool calls", async () => {
      // Arrange: Queue a simple text response
      testProvider.addResponse("Hello! I'm here to help.");

      // Act: Spawn and invoke the agent
      const { agentStub } = await spawnAgent("loop-simple-completion");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Hello" }],
          }),
        })
      );

      // Wait for completion
      const result = await waitForStatus(agentStub, "completed");

      // Assert
      expect(result.run.status).toBe("completed");
      expect(testProvider.requests).toHaveLength(1);
      // Messages have extra fields (ts, toolCalls, etc.) - check role and content
      const userMsg = testProvider.requests[0].messages.find(
        (m) => m.role === "user" && "content" in m && m.content === "Hello"
      );
      expect(userMsg).toBeDefined();

      // Verify the assistant message is in state
      const messages = result.state.messages as Array<{ role: string; content?: string }>;
      const assistantMsg = messages.find((m) => m.role === "assistant");
      expect(assistantMsg?.content).toBe("Hello! I'm here to help.");
    });
  });

  describe("Single tool call", () => {
    it("should execute tool and complete with result", async () => {
      // Arrange: Model calls echo tool, then completes
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "echo", args: { message: "test message" } }],
      });
      testProvider.addResponse("The echo result was: Echo: test message");

      // Act
      const { agentStub } = await spawnAgent("loop-single-tool");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Please echo 'test message'" }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert
      expect(result.run.status).toBe("completed");
      expect(testProvider.requests).toHaveLength(2); // Initial + after tool result
      expect(testProvider.toolCalls).toHaveLength(1);
      expect(testProvider.toolCalls[0].name).toBe("echo");

      // Verify tool result message was added
      const messages = result.state.messages as Array<{ role: string; content?: string; toolCallId?: string }>;
      const toolResultMsg = messages.find((m) => m.role === "tool");
      expect(toolResultMsg?.content).toBe("Echo: test message");
      expect(toolResultMsg?.toolCallId).toBe("call_1");
    });

    it("should handle tool returning structured data", async () => {
      // Arrange: Model calls add tool which returns { result: number }
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "add", args: { a: 5, b: 3 } }],
      });
      testProvider.addResponse("5 + 3 = 8");

      // Act
      const { agentStub } = await spawnAgent("loop-structured-tool");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "What is 5 + 3?" }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert
      expect(result.run.status).toBe("completed");
      expect(testProvider.toolCalls[0]).toEqual({
        id: "call_1",
        name: "add",
        args: { a: 5, b: 3 },
      });

      // Structured result should be JSON-stringified
      const messages = result.state.messages as Array<{ role: string; content?: string }>;
      const toolResultMsg = messages.find((m) => m.role === "tool");
      expect(toolResultMsg?.content).toBe('{"result":8}');
    });
  });

  describe("Multi-turn tool calls", () => {
    it("should handle multiple sequential tool calls", async () => {
      // Arrange: Model makes two tool calls in sequence
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "add", args: { a: 2, b: 3 } }],
      });
      testProvider.addResponse({
        toolCalls: [{ id: "call_2", name: "add", args: { a: 5, b: 4 } }],
      });
      testProvider.addResponse("First result was 5, second result was 9.");

      // Act
      const { agentStub } = await spawnAgent("loop-multi-turn");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Add 2+3, then add 5+4" }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert
      expect(result.run.status).toBe("completed");
      expect(testProvider.requests).toHaveLength(3);
      expect(testProvider.toolCalls).toHaveLength(2);

      // Verify the conversation history shows both tool interactions
      const messages = result.state.messages as Array<{ role: string }>;
      const toolMessages = messages.filter((m) => m.role === "tool");
      expect(toolMessages).toHaveLength(2);
    });
  });

  describe("Parallel tool calls", () => {
    it("should execute multiple tools in parallel when model requests them together", async () => {
      // Arrange: Model requests two tool calls at once
      testProvider.addResponse({
        toolCalls: [
          { id: "call_1", name: "add", args: { a: 1, b: 2 } },
          { id: "call_2", name: "add", args: { a: 3, b: 4 } },
        ],
      });
      testProvider.addResponse("Results: 3 and 7");

      // Act
      const { agentStub } = await spawnAgent("loop-parallel-tools");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Calculate 1+2 and 3+4 at the same time" }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert
      expect(result.run.status).toBe("completed");
      expect(testProvider.toolCalls).toHaveLength(2);

      // Both tool results should be in messages
      const messages = result.state.messages as Array<{ role: string; toolCallId?: string }>;
      const toolMessages = messages.filter((m) => m.role === "tool");
      expect(toolMessages).toHaveLength(2);
      expect(toolMessages.map((m) => m.toolCallId).sort()).toEqual(["call_1", "call_2"]);
    });
  });

  describe("Error handling", () => {
    it("should handle tool not found gracefully", async () => {
      // Arrange: Model tries to call a tool that doesn't exist
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "nonexistent_tool", args: {} }],
      });
      testProvider.addResponse("I couldn't find that tool, but I'll try something else.");

      // Act
      const { agentStub } = await spawnAgent("loop-tool-not-found");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Use a fake tool" }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert: Should complete (error is passed back to model which can recover)
      expect(result.run.status).toBe("completed");

      // The tool result should contain the error
      const messages = result.state.messages as Array<{ role: string; content?: string }>;
      const toolResultMsg = messages.find((m) => m.role === "tool");
      expect(toolResultMsg?.content).toContain("Error:");
      expect(toolResultMsg?.content).toContain("not found");
    });

    it("should reach error status when max iterations exceeded", async () => {
      // Arrange: Model keeps calling tools forever
      testProvider.onRequest(() => ({
        toolCalls: [{ id: `call_${Date.now()}`, name: "echo", args: { message: "loop" } }],
      }));

      // Act
      const { agentStub } = await spawnAgent("loop-max-iterations");

      // Set a very low iteration limit
      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Keep going" }],
            vars: { MAX_ITERATIONS: 3 },
          }),
        })
      );

      const result = await waitForStatus(agentStub, "error", 10000);

      // Assert
      expect(result.run.status).toBe("error");
    });
  });

  describe("Cancellation", () => {
    it("should stop the agent loop when canceled", async () => {
      // Arrange: Model would keep running but we cancel it
      testProvider.onRequest(() => ({
        toolCalls: [{ id: `call_${Date.now()}`, name: "echo", args: { message: "working" } }],
      }));

      // Act
      const { agentStub } = await spawnAgent("loop-cancel");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Do something" }],
          }),
        })
      );

      // Give it a moment to start, then cancel
      await new Promise((r) => setTimeout(r, 100));

      const cancelRes = await agentStub.fetch(
        new Request("http://do/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "cancel" }),
        })
      );

      expect(cancelRes.ok).toBe(true);

      const result = await waitForStatus(agentStub, "canceled");
      expect(result.run.status).toBe("canceled");
    });
  });

  describe("Events", () => {
    it("should emit events throughout the agent loop", async () => {
      // Arrange
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "echo", args: { message: "hi" } }],
      });
      testProvider.addResponse("Done!");

      // Act
      const { agentStub } = await spawnAgent("loop-events");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Echo hi" }],
          }),
        })
      );

      await waitForStatus(agentStub, "completed");

      // Get events
      const eventsRes = await agentStub.fetch(new Request("http://do/events"));
      const { events } = await eventsRes.json() as { events: Array<{ type: string; data: unknown }> };

      // Assert: Should have key lifecycle events
      const eventTypes = events.map((e) => e.type);

      // Event types follow OTel GenAI semantic conventions
      expect(eventTypes).toContain("gen_ai.agent.invoked");
      expect(eventTypes).toContain("gen_ai.agent.step");
      expect(eventTypes).toContain("gen_ai.chat.start");
      expect(eventTypes).toContain("gen_ai.chat.finish");
      expect(eventTypes).toContain("gen_ai.tool.start");
      expect(eventTypes).toContain("gen_ai.tool.finish");
      expect(eventTypes).toContain("gen_ai.content.message");
      expect(eventTypes).toContain("gen_ai.agent.completed");
    });
  });

  describe("Context preservation", () => {
    it("should maintain conversation history across turns", async () => {
      // Arrange
      testProvider.addResponse("I'll remember that!");
      testProvider.addResponse("You told me your name is Alice.");

      // Act - first turn
      const { agentStub } = await spawnAgent("loop-context");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "My name is Alice" }],
          }),
        })
      );

      await waitForStatus(agentStub, "completed");

      // Act - second turn (new invoke)
      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "What is my name?" }],
          }),
        })
      );

      await waitForStatus(agentStub, "completed");

      // Assert: Second request should include full history
      expect(testProvider.requests).toHaveLength(2);
      const secondRequest = testProvider.requests[1];
      const userMessages = secondRequest.messages.filter((m) => m.role === "user");

      // Should have both user messages from the conversation
      expect(userMessages).toHaveLength(2);
    });
  });
});
