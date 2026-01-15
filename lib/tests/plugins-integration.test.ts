import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { testProvider, getAgentByName, type Env } from "./worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

/**
 * Helper to wait for agent to reach a specific status.
 */
async function waitForStatus(
  agentStub: { fetch: (req: Request) => Promise<Response> },
  expectedStatus: string,
  timeoutMs = 5000,
  pollMs = 50
): Promise<{ state: Record<string, unknown>; run: { status: string; reason?: string } }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await agentStub.fetch(new Request("http://do/state"));
    const data = (await res.json()) as {
      state: Record<string, unknown>;
      run: { status: string; reason?: string };
    };
    if (data.run.status === expectedStatus) {
      return data;
    }
    // If status is a terminal state, return immediately
    if (["error", "canceled", "completed"].includes(data.run.status)) {
      return data;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timeout waiting for status "${expectedStatus}"`);
}

/**
 * Helper to spawn an agent and return stubs.
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
  const { id: agentId } = (await spawnRes.json()) as { id: string };
  const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

  return { agentId, agentStub, agencyStub };
}

describe("Plugin Integration Tests", () => {
  beforeEach(() => {
    testProvider.reset();
  });

  describe("vars plugin", () => {
    it("should resolve $VAR_NAME in tool arguments", async () => {
      // Arrange: Set up agency vars BEFORE spawning agent
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "echo", args: { message: "$MY_MESSAGE" } }],
      });
      testProvider.addResponse("Done echoing!");

      // Get agency stub first and set vars BEFORE spawning agent
      const agencyStub = await getAgentByName(env.AGENCY, "vars-integration-test");
      await agencyStub.fetch(
        new Request("http://do/vars", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ MY_MESSAGE: "Hello from vars!" }),
        })
      );

      // Now spawn the agent (it will inherit the vars)
      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = (await spawnRes.json()) as { id: string };
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      // Invoke the agent - pass vars in the invoke body to ensure they're there
      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Echo my message using $MY_MESSAGE" }],
            vars: { MY_MESSAGE: "Hello from vars!" },
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert: The tool result should show the resolved var value
      expect(result.run.status).toBe("completed");
      const messages = result.state.messages as Array<{ role: string; content?: string }>;
      const toolResultMsg = messages.find((m) => m.role === "tool");
      expect(toolResultMsg?.content).toBe("Echo: Hello from vars!");
    });

    it("should preserve non-string types when resolving full var reference", async () => {
      // Arrange
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "add", args: { a: "$NUM_A", b: "$NUM_B" } }],
      });
      testProvider.addResponse("The sum is 15");

      const { agentStub } = await spawnAgent("vars-type-integration");

      // Pass vars directly in invoke body
      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Add $NUM_A and $NUM_B" }],
            vars: { NUM_A: 10, NUM_B: 5 },
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert: Tool should receive numeric values and compute correctly
      expect(result.run.status).toBe("completed");
      const messages = result.state.messages as Array<{ role: string; content?: string }>;
      const toolResultMsg = messages.find((m) => m.role === "tool");
      expect(toolResultMsg?.content).toBe('{"result":15}');
    });

    it("should support string interpolation with multiple vars", async () => {
      // Arrange
      testProvider.addResponse({
        toolCalls: [
          { id: "call_1", name: "echo", args: { message: "Hello $NAME, your score is $SCORE!" } },
        ],
      });
      testProvider.addResponse("Done!");

      const { agentStub } = await spawnAgent("vars-interpolation");

      // Pass vars directly in invoke body
      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Greet me" }],
            vars: { NAME: "Alice", SCORE: 100 },
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert
      expect(result.run.status).toBe("completed");
      const messages = result.state.messages as Array<{ role: string; content?: string }>;
      const toolResultMsg = messages.find((m) => m.role === "tool");
      expect(toolResultMsg?.content).toBe("Echo: Hello Alice, your score is 100!");
    });
  });

  describe("hitl plugin", () => {
    it("should pause agent when risky tool is called", async () => {
      // Arrange: Set HITL_TOOLS BEFORE spawning
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "echo", args: { message: "risky operation" } }],
      });

      const agencyStub = await getAgentByName(env.AGENCY, "hitl-pause-test");
      await agencyStub.fetch(
        new Request("http://do/vars", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ HITL_TOOLS: ["echo"] }),
        })
      );

      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = (await spawnRes.json()) as { id: string };
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Do the risky thing" }],
          }),
        })
      );

      // Wait for paused status
      const result = await waitForStatus(agentStub, "paused");

      // Assert
      expect(result.run.status).toBe("paused");
      expect(result.run.reason).toBe("hitl");
    });

    it("should resume and complete after approval", async () => {
      // Arrange: Set vars BEFORE spawning
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "echo", args: { message: "approved" } }],
      });
      testProvider.addResponse("Operation completed successfully!");

      const agencyStub = await getAgentByName(env.AGENCY, "hitl-approve-test-2");
      await agencyStub.fetch(
        new Request("http://do/vars", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ HITL_TOOLS: ["echo"] }),
        })
      );

      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = (await spawnRes.json()) as { id: string };
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Do the risky thing" }],
          }),
        })
      );

      // Wait for paused
      await waitForStatus(agentStub, "paused");

      // Approve
      const approveRes = await agentStub.fetch(
        new Request("http://do/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "approve", approved: true }),
        })
      );
      expect(approveRes.ok).toBe(true);

      // Wait for completion
      const result = await waitForStatus(agentStub, "completed");

      // Assert
      expect(result.run.status).toBe("completed");
      const messages = result.state.messages as Array<{ role: string; content?: string }>;
      const toolResultMsg = messages.find((m) => m.role === "tool");
      expect(toolResultMsg?.content).toBe("Echo: approved");
    });

    it("should allow modifying tool calls on approval", async () => {
      // Arrange: Set vars BEFORE spawning
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "echo", args: { message: "original" } }],
      });
      testProvider.addResponse("Modified operation completed!");

      const agencyStub = await getAgentByName(env.AGENCY, "hitl-modify-test");
      await agencyStub.fetch(
        new Request("http://do/vars", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ HITL_TOOLS: ["echo"] }),
        })
      );

      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = (await spawnRes.json()) as { id: string };
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Do something" }],
          }),
        })
      );

      await waitForStatus(agentStub, "paused");

      // Approve with modified tool calls
      await agentStub.fetch(
        new Request("http://do/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "approve",
            approved: true,
            modifiedToolCalls: [{ id: "call_1", name: "echo", args: { message: "modified by human" } }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert: Should use the modified args
      expect(result.run.status).toBe("completed");
      const messages = result.state.messages as Array<{ role: string; content?: string }>;
      const toolResultMsg = messages.find((m) => m.role === "tool");
      expect(toolResultMsg?.content).toBe("Echo: modified by human");
    });

    it("should not pause for non-watched tools", async () => {
      // Arrange: Set vars BEFORE spawning - only watch 'add'
      testProvider.addResponse({
        toolCalls: [{ id: "call_1", name: "echo", args: { message: "safe" } }],
      });
      testProvider.addResponse("Done!");

      const agencyStub = await getAgentByName(env.AGENCY, "hitl-safe-tool-test");
      await agencyStub.fetch(
        new Request("http://do/vars", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ HITL_TOOLS: ["add"] }),
        })
      );

      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = (await spawnRes.json()) as { id: string };
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Echo something" }],
          }),
        })
      );

      // Should complete without pausing
      const result = await waitForStatus(agentStub, "completed");
      expect(result.run.status).toBe("completed");
    });
  });

  describe("planning plugin", () => {
    it("should allow model to create todos via write_todos tool", async () => {
      // Arrange: Model calls write_todos
      testProvider.addResponse({
        toolCalls: [
          {
            id: "call_1",
            name: "write_todos",
            args: {
              todos: [
                { content: "First task", status: "pending" },
                { content: "Second task", status: "in_progress" },
              ],
            },
          },
        ],
      });
      testProvider.addResponse("I've created a todo list for you!");

      // Act
      const { agentStub } = await spawnAgent("planning-write-test");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Create a task list for implementing a feature" }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert
      expect(result.run.status).toBe("completed");
      const todos = result.state.todos as Array<{ content: string; status: string }>;
      expect(todos).toHaveLength(2);
      expect(todos[0]).toEqual({ content: "First task", status: "pending" });
      expect(todos[1]).toEqual({ content: "Second task", status: "in_progress" });
    });

    it("should persist todos across multiple invocations", async () => {
      // Arrange: Two invocations - first creates todos, second updates them
      testProvider.addResponse({
        toolCalls: [
          {
            id: "call_1",
            name: "write_todos",
            args: {
              todos: [
                { content: "Task A", status: "pending" },
                { content: "Task B", status: "pending" },
              ],
            },
          },
        ],
      });
      testProvider.addResponse("Created 2 tasks");
      testProvider.addResponse({
        toolCalls: [
          {
            id: "call_2",
            name: "write_todos",
            args: {
              todos: [
                { content: "Task A", status: "completed" },
                { content: "Task B", status: "in_progress" },
                { content: "Task C", status: "pending" },
              ],
            },
          },
        ],
      });
      testProvider.addResponse("Updated the task list");

      // Act - First invocation
      const { agentStub } = await spawnAgent("planning-persist-test");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Create tasks" }],
          }),
        })
      );

      await waitForStatus(agentStub, "completed");

      // Act - Second invocation
      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Mark Task A complete and add Task C" }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");

      // Assert: Should have updated todos
      const todos = result.state.todos as Array<{ content: string; status: string }>;
      expect(todos).toHaveLength(3);
      expect(todos[0]).toEqual({ content: "Task A", status: "completed" });
      expect(todos[1]).toEqual({ content: "Task B", status: "in_progress" });
      expect(todos[2]).toEqual({ content: "Task C", status: "pending" });
    });

    it("should have write_todos tool available during model call", async () => {
      // The write_todos tool is registered dynamically in beforeModel, so we verify
      // by checking the model request includes the tool definition
      testProvider.addResponse("I see the task list tool is available.");

      const { agentStub } = await spawnAgent("planning-tools-test");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "What tools do you have?" }],
          }),
        })
      );

      await waitForStatus(agentStub, "completed");

      // Check the model request included write_todos
      expect(testProvider.requests).toHaveLength(1);
      const toolDefs = testProvider.requests[0].toolDefs ?? [];
      const hasWriteTodos = toolDefs.some((t: { name: string }) => t.name === "write_todos");
      expect(hasWriteTodos).toBe(true);
    });
  });

  describe("context plugin", () => {
    it("should track checkpoint state", async () => {
      // Simple test - just verify context plugin state is exposed
      testProvider.addResponse("Hello!");

      const { agentStub } = await spawnAgent("context-state-test");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Hi" }],
          }),
        })
      );

      await waitForStatus(agentStub, "completed");

      const stateRes = await agentStub.fetch(new Request("http://do/state"));
      const state = (await stateRes.json()) as {
        state: { hasCheckpoint: boolean; checkpointCount: number };
      };

      // Context plugin exposes checkpoint state
      expect(state.state.hasCheckpoint).toBe(false);
      expect(state.state.checkpointCount).toBe(0);
    });
  });

  describe("logger plugin", () => {
    it("should log events without affecting agent behavior", async () => {
      // Logger is passive - just verify agent still works with it enabled
      testProvider.addResponse("Logged response");

      const { agentStub } = await spawnAgent("logger-integration-test");

      await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: "Test logging" }],
          }),
        })
      );

      const result = await waitForStatus(agentStub, "completed");
      expect(result.run.status).toBe("completed");
    });
  });
});
