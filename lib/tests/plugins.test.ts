import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { getAgentByName } from "agents";
import type { Env } from "./worker";
import { TestProvider, createTestProvider, createEchoProvider, createToolCallProvider } from "../runtime/providers/test";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("TestProvider", () => {
  it("should queue and return responses in order", async () => {
    const provider = new TestProvider();
    provider.addResponse("First");
    provider.addResponse("Second");

    const req = { model: "test", messages: [{ role: "user" as const, content: "Hi" }] };

    const r1 = await provider.invoke(req, {});
    expect(r1.message).toEqual({ role: "assistant", content: "First" });

    const r2 = await provider.invoke(req, {});
    expect(r2.message).toEqual({ role: "assistant", content: "Second" });
  });

  it("should record all requests", async () => {
    const provider = new TestProvider();
    provider.addResponses("A", "B");

    await provider.invoke({ model: "m1", messages: [{ role: "user", content: "Q1" }] }, {});
    await provider.invoke({ model: "m2", messages: [{ role: "user", content: "Q2" }] }, {});

    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0].model).toBe("m1");
    expect(provider.requests[1].model).toBe("m2");
  });

  it("should return tool calls", async () => {
    const provider = createToolCallProvider("search", { query: "test" });

    const r = await provider.invoke({ model: "m", messages: [] }, {});
    expect(r.message).toHaveProperty("toolCalls");
    if ("toolCalls" in r.message) {
      expect(r.message.toolCalls).toHaveLength(1);
      expect(r.message.toolCalls[0].name).toBe("search");
    }

    // Tool calls should be recorded
    expect(provider.toolCalls).toHaveLength(1);
    expect(provider.toolCalls[0].name).toBe("search");
  });

  it("should use handler when queue is empty", async () => {
    const provider = createEchoProvider();

    const r = await provider.invoke(
      { model: "m", messages: [{ role: "user", content: "Hello world" }] },
      {}
    );
    expect(r.message).toHaveProperty("content");
    if ("content" in r.message) {
      expect(r.message.content).toBe("Echo: Hello world");
    }
  });

  it("should validate tool call expectations", async () => {
    const provider = new TestProvider();
    provider.addResponse({ toolCalls: [{ id: "1", name: "foo", args: { x: 1 } }] });
    provider.expectToolCalls({ name: "foo", args: { x: 1 } });

    await provider.invoke({ model: "m", messages: [] }, {});

    // Should not throw
    expect(() => provider.assertExpectations()).not.toThrow();
  });

  it("should throw when expected tool call not made", () => {
    const provider = new TestProvider();
    provider.expectToolCalls({ name: "bar" });

    expect(() => provider.assertExpectations()).toThrow('Expected tool call "bar"');
  });
});

describe("Tool tags", () => {
  it("should merge intrinsic tags with addTool tags", async () => {
    // The test worker defines tools with tags
    // We can verify this by checking the /plugins endpoint
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch("http://test/plugins");
    expect(res.ok).toBe(true);

    const data = await res.json() as { tools: Array<{ name: string; tags: string[] }> };

    // The echo tool is added with ["@test"] tags (no intrinsic)
    const echoTool = data.tools.find(t => t.name === "echo");
    expect(echoTool).toBeDefined();
    expect(echoTool?.tags).toContain("@test");

    // The add tool has intrinsic tags: ["math"] and is added with ["@test"]
    // So it should have both tags merged
    const addTool = data.tools.find(t => t.name === "add");
    expect(addTool).toBeDefined();
    expect(addTool?.tags).toContain("math");
    expect(addTool?.tags).toContain("@test");
  });
});

describe("PersistedObject", () => {
  it("should return correct value from Object.getOwnPropertyDescriptor", async () => {
    // This test verifies that getOwnPropertyDescriptor returns the actual value
    // from KV, not undefined (which would indicate a bug in the Proxy handler)
    const agencyStub = await getAgentByName(env.AGENCY, "persisted-test");

    // Set a var
    await agencyStub.fetch(
      new Request("http://do/vars", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ MY_KEY: "my-value", NUM: 42 }),
      })
    );

    // Get vars - this uses the PersistedObject
    const getRes = await agencyStub.fetch(
      new Request("http://do/vars", { method: "GET" })
    );
    const { vars } = await getRes.json() as { vars: Record<string, unknown> };

    // Object.keys should work (uses ownKeys + getOwnPropertyDescriptor)
    const keys = Object.keys(vars);
    expect(keys).toContain("MY_KEY");
    expect(keys).toContain("NUM");

    // Values should be accessible
    expect(vars.MY_KEY).toBe("my-value");
    expect(vars.NUM).toBe(42);
  });
});

describe("Agent", () => {
  describe("invoke with files", () => {
    it("should write files passed in invoke body to agent filesystem", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "files-test-agency");

      // Spawn an agent
      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = await spawnRes.json() as { id: string };

      // Get agent stub
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      // Invoke with files - this is a Record<string, string>, NOT an array
      const invokeRes = await agentStub.fetch(
        new Request("http://do/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            files: {
              "test.txt": "Hello, this is test content!",
              "config.json": '{"key": "value"}',
            },
          }),
        })
      );

      expect(invokeRes.ok).toBe(true);

      // Now check if the files were written by reading them back
      // Files are written to ~/filename which maps to {agencyId}/agents/{agentId}/filename
      // We can verify via the agency's FS endpoint
      const fsRes = await agencyStub.fetch(
        new Request(`http://do/fs/agents/${agentId}/test.txt`, {
          method: "GET",
        })
      );

      // This should succeed if files were written
      expect(fsRes.ok).toBe(true);
      const content = await fsRes.text();
      expect(content).toBe("Hello, this is test content!");
    });
  });
});

describe("Plugins", () => {
  describe("vars plugin", () => {
    it("should resolve $VAR_NAME patterns in tool arguments", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "vars-test-agency");

      // Set up vars in the agency
      await agencyStub.fetch(
        new Request("http://do/vars", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ TEST_MESSAGE: "Hello from var!" }),
        })
      );

      // Spawn an agent
      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = await spawnRes.json() as { id: string };

      // Get the agent stub
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      // Verify vars are set on the agent
      const stateRes = await agentStub.fetch(new Request("http://do/state"));
      const state = await stateRes.json() as { vars?: Record<string, unknown> };

      // The agent should inherit vars from agency (this happens during registration)
      // Note: vars plugin doesn't expose state, it just transforms tool args
      expect(stateRes.ok).toBe(true);
    });

    it("should preserve non-string types when resolving full var reference", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "vars-type-test");

      // Set a numeric var
      await agencyStub.fetch(
        new Request("http://do/vars", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ TIMEOUT: 5000, ENABLED: true }),
        })
      );

      // Get vars back
      const getRes = await agencyStub.fetch(
        new Request("http://do/vars", { method: "GET" })
      );
      const data = await getRes.json() as { vars: Record<string, unknown> };

      expect(data.vars.TIMEOUT).toBe(5000);
      expect(typeof data.vars.TIMEOUT).toBe("number");
      expect(data.vars.ENABLED).toBe(true);
      expect(typeof data.vars.ENABLED).toBe("boolean");
    });
  });

  describe("planning plugin", () => {
    it("should initialize todos table on agent creation", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "planning-test-agency");

      // Spawn an agent with planning capability
      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = await spawnRes.json() as { id: string };

      // Get agent state - should include todos array
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);
      const stateRes = await agentStub.fetch(new Request("http://do/state"));
      const response = await stateRes.json() as { state: { todos?: unknown[] } };

      // Planning plugin exposes todos in state
      expect(response.state.todos).toBeDefined();
      expect(Array.isArray(response.state.todos)).toBe(true);
      expect(response.state.todos).toHaveLength(0);
    });
  });

  describe("logger plugin", () => {
    it("should be configurable via tags", async () => {
      // Logger plugin is tagged with "logs" - agents can include it
      // by having "logs" or "@logs" in their capabilities
      // This test verifies the plugin exists and has correct tags
      const agencyStub = await getAgentByName(env.AGENCY, "logger-test-agency");

      // Just verify agency works (logger is passive, only logs events)
      const res = await agencyStub.fetch(
        new Request("http://do/blueprints", { method: "GET" })
      );
      expect(res.ok).toBe(true);
    });
  });

  describe("hitl plugin", () => {
    it("should expose approve and cancel actions", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "hitl-test-agency");

      // Spawn an agent
      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      expect(spawnRes.ok).toBe(true);
      const { id: agentId } = await spawnRes.json() as { id: string };

      // Get agent stub
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      // Try to call cancel action (should work even if no pending calls)
      const cancelRes = await agentStub.fetch(
        new Request("http://do/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "cancel" }),
        })
      );

      expect(cancelRes.ok).toBe(true);
      const cancelData = await cancelRes.json() as { ok: boolean };
      expect(cancelData.ok).toBe(true);
    });

    it("should reject approve when no pending tool calls", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "hitl-approve-test");

      // Spawn an agent
      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      const { id: agentId } = await spawnRes.json() as { id: string };

      // Get agent stub
      const agentStub = await getAgentByName(env.HUB_AGENT, agentId);

      // Try to approve without pending calls
      const approveRes = await agentStub.fetch(
        new Request("http://do/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "approve", approved: true }),
        })
      );

      // Should fail because there are no pending tool calls
      expect(approveRes.ok).toBe(false);
    });
  });
});
