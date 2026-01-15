import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { getAgentByName } from "agents";
import { testProvider } from "./worker";
import type { Env } from "./worker";

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
    // If status is a terminal state different from expected, return immediately
    if (["error", "canceled", "completed"].includes(data.run.status) && data.run.status !== expectedStatus) {
      return data;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timeout waiting for status "${expectedStatus}"`);
}

/**
 * Helper to spawn an agent of a specific type.
 */
async function spawnAgent(
  agencyName: string,
  agentType: string
): Promise<{
  agentId: string;
  agentStub: { fetch: (req: Request) => Promise<Response> };
  agencyStub: { fetch: (req: Request | string) => Promise<Response> };
}> {
  const agencyStub = await getAgentByName(env.AGENCY, agencyName);

  const spawnRes = await agencyStub.fetch(
    new Request("http://do/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentType }),
    })
  );

  expect(spawnRes.ok).toBe(true);
  const { id: agentId } = (await spawnRes.json()) as { id: string };
  const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

  return { agentId, agentStub, agencyStub };
}

describe("Subagents Plugin Integration Tests", () => {
  beforeEach(() => {
    testProvider.reset();
  });

  it("should spawn child agent and pause parent", async () => {
    // Arrange: Parent calls task tool to spawn child
    testProvider.addResponse({
      toolCalls: [
        { id: "call_1", name: "task", args: { description: "Do something", subagentType: "child-agent" } },
      ],
    });
    // Child's response (child will complete while parent is paused)
    testProvider.addResponse("Child completed the task!");
    // Parent's continuation after child reports back
    testProvider.addResponse("Got the result from child!");

    // Act: Spawn parent agent
    const { agentStub: parentStub } = await spawnAgent("subagents-test-1", "parent-agent");

    await parentStub.fetch(
      new Request("http://do/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Spawn a child to do something" }],
        }),
      })
    );

    // Wait for parent to complete (child runs immediately and reports back)
    const result = await waitForStatus(parentStub, "completed", 10000);

    // Assert: Parent should have completed successfully
    expect(result.run.status).toBe("completed");

    // Check subagents state shows completed child
    const subagents = result.state.subagents as Array<{ status: string; agentType: string }>;
    expect(subagents).toHaveLength(1);
    expect(subagents[0].status).toBe("completed");
    expect(subagents[0].agentType).toBe("child-agent");
  });

  it("should complete parent-child-parent flow", async () => {
    // Arrange: Parent calls task tool, child completes, parent gets result and finishes
    testProvider.addResponse({
      toolCalls: [
        { id: "call_1", name: "task", args: { description: "Calculate 2+2", subagentType: "child-agent" } },
      ],
    });
    // Child's response (will report back to parent)
    testProvider.addResponse("The answer is 4");
    // Parent's final response after receiving child result
    testProvider.addResponse("The child calculated: 4");

    // Act: Spawn parent agent
    const { agentStub: parentStub } = await spawnAgent("subagents-test-2", "parent-agent");

    await parentStub.fetch(
      new Request("http://do/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Ask a child to calculate 2+2" }],
        }),
      })
    );

    // Wait for parent to complete (goes paused -> resumed -> completed)
    const result = await waitForStatus(parentStub, "completed", 10000);

    // Assert: Parent should have completed
    expect(result.run.status).toBe("completed");

    // Check subagents state shows completed
    const subagents = result.state.subagents as Array<{ status: string; report?: string }>;
    expect(subagents).toHaveLength(1);
    expect(subagents[0].status).toBe("completed");
    expect(subagents[0].report).toBe("The answer is 4");

    // Check parent received tool result with child's report
    const messages = result.state.messages as Array<{ role: string; content?: string }>;
    const toolResult = messages.find((m) => m.role === "tool");
    expect(toolResult).toBeDefined();
    const parsed = JSON.parse(toolResult!.content!);
    expect(parsed.result).toBe("The answer is 4");
  });

  it("should support parallel subagent spawning", async () => {
    // Arrange: Parent spawns two children in parallel
    testProvider.addResponse({
      toolCalls: [
        { id: "call_1", name: "task", args: { description: "Research topic A", subagentType: "child-agent" } },
        { id: "call_2", name: "task", args: { description: "Research topic B", subagentType: "child-agent" } },
      ],
    });
    // Both children respond
    testProvider.addResponse("Research A completed");
    testProvider.addResponse("Research B completed");
    // Parent synthesizes
    testProvider.addResponse("Combined research from A and B");

    // Act
    const { agentStub: parentStub } = await spawnAgent("subagents-test-3", "parent-agent");

    await parentStub.fetch(
      new Request("http://do/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Research topics A and B in parallel" }],
        }),
      })
    );

    // Wait for completion
    const result = await waitForStatus(parentStub, "completed", 10000);

    // Assert
    expect(result.run.status).toBe("completed");
    const subagents = result.state.subagents as Array<{ status: string }>;
    expect(subagents).toHaveLength(2);
    expect(subagents.every((s) => s.status === "completed")).toBe(true);
  });

  it("should expose task and message_agent tools to parent", async () => {
    // Just verify the tools are registered
    testProvider.addResponse("I have the task tool available");

    const { agentStub: parentStub } = await spawnAgent("subagents-test-4", "parent-agent");

    await parentStub.fetch(
      new Request("http://do/invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "What tools do you have?" }],
        }),
      })
    );

    await waitForStatus(parentStub, "completed");

    // Check model request included task and message_agent tools
    expect(testProvider.requests).toHaveLength(1);
    const toolDefs = testProvider.requests[0].toolDefs ?? [];
    const toolNames = toolDefs.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("task");
    expect(toolNames).toContain("message_agent");
  });
});
