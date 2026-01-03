import { env, SELF } from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import { AgentHubClient } from "../client";
import type { Env } from "./worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

// Create a client that uses the test worker's fetch
function createTestClient() {
  return new AgentHubClient({
    baseUrl: "http://localhost",
    fetch: SELF.fetch.bind(SELF),
  });
}

describe("HTTP API", () => {
  describe("plugins endpoint", () => {
    it("should list registered plugins and tools", async () => {
      const client = createTestClient();
      const { plugins, tools } = await client.getPlugins();

      // Our test worker registers 2 tools with @test tag
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("echo");
      expect(tools.map((t) => t.name)).toContain("add");

      // Both tools should have @test tag
      for (const tool of tools) {
        expect(tool.tags).toContain("@test");
      }
    });
  });

  describe("agencies endpoint", () => {
    it("should create an agency", async () => {
      const client = createTestClient();
      const agency = await client.createAgency({ name: "test-agency-http" });

      expect(agency.id).toBe("test-agency-http");
      expect(agency.name).toBe("test-agency-http");
      expect(agency.createdAt).toBeDefined();
    });

    it("should list agencies", async () => {
      const client = createTestClient();

      // Create a unique agency for this test
      await client.createAgency({ name: "test-list-agency" });

      const { agencies } = await client.listAgencies();
      expect(agencies.length).toBeGreaterThan(0);
      expect(agencies.some((a) => a.id === "test-list-agency")).toBe(true);
    });

    it("should reject invalid agency names", async () => {
      const client = createTestClient();

      await expect(
        client.createAgency({ name: "invalid name" })
      ).rejects.toThrow();
    });

    it("should reject duplicate agency names", async () => {
      const client = createTestClient();

      await client.createAgency({ name: "duplicate-test" });

      await expect(
        client.createAgency({ name: "duplicate-test" })
      ).rejects.toThrow();
    });
  });

  describe("agency client", () => {
    let agencyName: string;

    beforeAll(async () => {
      agencyName = `agency-client-test-${Date.now()}`;
      const client = createTestClient();
      await client.createAgency({ name: agencyName });
    });

    describe("blueprints", () => {
      it("should list blueprints including static ones", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        const { blueprints } = await agency.listBlueprints();

        // Should include the static test-agent blueprint
        expect(blueprints.some((b) => b.name === "test-agent")).toBe(true);
      });

      it("should create a dynamic blueprint", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        const result = await agency.createBlueprint({
          name: "dynamic-agent",
          description: "A dynamically created agent",
          prompt: "You are a dynamic test agent.",
          capabilities: ["@test"],
        });

        expect(result.ok).toBe(true);
        expect(result.name).toBe("dynamic-agent");

        // Verify it's in the list
        const { blueprints } = await agency.listBlueprints();
        expect(blueprints.some((b) => b.name === "dynamic-agent")).toBe(true);
      });

      it("should delete a blueprint", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        // Create a blueprint to delete
        await agency.createBlueprint({
          name: "to-delete-bp",
          prompt: "test",
          capabilities: [],
        });

        // Delete it
        const result = await agency.deleteBlueprint("to-delete-bp");
        expect(result.ok).toBe(true);

        // Verify it's gone
        const { blueprints } = await agency.listBlueprints();
        expect(blueprints.some((b) => b.name === "to-delete-bp")).toBe(false);
      });
    });

    describe("vars", () => {
      it("should get and set vars", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        // Set vars
        await agency.setVars({ API_KEY: "secret123", TIMEOUT: 5000 });

        // Get vars
        const { vars } = await agency.getVars();
        expect(vars.API_KEY).toBe("secret123");
        expect(vars.TIMEOUT).toBe(5000);
      });

      it("should get and set individual var", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        // Set a single var
        await agency.setVar("SINGLE_VAR", "hello world");

        // Get it back
        const result = await agency.getVar("SINGLE_VAR");
        expect(result.key).toBe("SINGLE_VAR");
        expect(result.value).toBe("hello world");
      });

      it("should delete a var", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        // Set a var
        await agency.setVar("TO_DELETE_VAR", "bye");

        // Delete it
        const result = await agency.deleteVar("TO_DELETE_VAR");
        expect(result.ok).toBe(true);

        // Verify it's gone
        const { value } = await agency.getVar("TO_DELETE_VAR");
        expect(value).toBeUndefined();
      });
    });

    describe("schedules", () => {
      it("should create and list schedules", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        // Create a schedule
        const { schedule } = await agency.createSchedule({
          name: "http-test-schedule",
          agentType: "test-agent",
          type: "interval",
          intervalMs: 60000,
        });

        expect(schedule.id).toBeDefined();
        expect(schedule.name).toBe("http-test-schedule");
        expect(schedule.status).toBe("active");

        // List schedules
        const { schedules } = await agency.listSchedules();
        expect(schedules.some((s) => s.name === "http-test-schedule")).toBe(true);
      });

      it("should pause and resume a schedule", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        // Create a schedule
        const { schedule: created } = await agency.createSchedule({
          name: "pause-test-schedule",
          agentType: "test-agent",
          type: "interval",
          intervalMs: 60000,
        });

        // Pause
        const { schedule: paused } = await agency.pauseSchedule(created.id);
        expect(paused.status).toBe("paused");

        // Resume
        const { schedule: resumed } = await agency.resumeSchedule(created.id);
        expect(resumed.status).toBe("active");
      });

      it("should delete a schedule", async () => {
        const client = createTestClient();
        const agency = client.agency(agencyName);

        // Create a schedule
        const { schedule } = await agency.createSchedule({
          name: "delete-test-schedule",
          agentType: "test-agent",
          type: "interval",
          intervalMs: 60000,
        });

        // Delete
        const result = await agency.deleteSchedule(schedule.id);
        expect(result.ok).toBe(true);

        // Verify it's gone
        const { schedules } = await agency.listSchedules();
        expect(schedules.some((s) => s.id === schedule.id)).toBe(false);
      });
    });

    describe("agents", () => {
      it("should list agents (initially empty)", async () => {
        const client = createTestClient();
        const uniqueAgency = `agents-test-${Date.now()}`;
        await client.createAgency({ name: uniqueAgency });
        const agency = client.agency(uniqueAgency);

        const { agents } = await agency.listAgents();
        expect(agents).toEqual([]);
      });

      it("should spawn agents with relatedAgentId", async () => {
        const client = createTestClient();
        const uniqueAgency = `spawn-test-${Date.now()}`;
        await client.createAgency({ name: uniqueAgency });
        const agency = client.agency(uniqueAgency);

        // Spawn a root agent
        const rootAgent = await agency.spawnAgent({ agentType: "test-agent" });
        expect(rootAgent.id).toBeDefined();

        // Spawn a child agent with relatedAgentId
        const childAgent = await agency.spawnAgent({
          agentType: "test-agent",
          relatedAgentId: rootAgent.id,
        });
        expect(childAgent.id).toBeDefined();

        // List all agents - should include relatedAgentId
        const { agents } = await agency.listAgents();
        expect(agents).toHaveLength(2);

        const root = agents.find((a) => a.id === rootAgent.id);
        const child = agents.find((a) => a.id === childAgent.id);

        expect(root?.relatedAgentId).toBeUndefined();
        expect(child?.relatedAgentId).toBe(rootAgent.id);
      });

      it("should get agent tree for a specific agent", async () => {
        const client = createTestClient();
        const uniqueAgency = `tree-test-${Date.now()}`;
        await client.createAgency({ name: uniqueAgency });
        const agency = client.agency(uniqueAgency);

        // Create a simple hierarchy: A -> B -> C
        const agentA = await agency.spawnAgent({ agentType: "test-agent" });
        const agentB = await agency.spawnAgent({
          agentType: "test-agent",
          relatedAgentId: agentA.id,
        });
        const agentC = await agency.spawnAgent({
          agentType: "test-agent",
          relatedAgentId: agentB.id,
        });

        // Query tree from B's perspective
        const tree = await agency.getAgentTree(agentB.id);

        expect(tree.agent.id).toBe(agentB.id);
        expect(tree.ancestors).toHaveLength(1);
        expect(tree.ancestors[0].id).toBe(agentA.id);
        expect(tree.descendants).toHaveLength(1);
        expect(tree.descendants[0].id).toBe(agentC.id);
      });

      it("should get full agent forest", async () => {
        const client = createTestClient();
        const uniqueAgency = `forest-test-${Date.now()}`;
        await client.createAgency({ name: uniqueAgency });
        const agency = client.agency(uniqueAgency);

        // Create two independent trees
        // Tree 1: R1 -> C1
        const r1 = await agency.spawnAgent({ agentType: "test-agent" });
        await agency.spawnAgent({
          agentType: "test-agent",
          relatedAgentId: r1.id,
        });

        // Tree 2: R2 (standalone)
        const r2 = await agency.spawnAgent({ agentType: "test-agent" });

        // Get full forest
        const forest = await agency.getAgentForest();

        // Should have 2 root nodes
        expect(forest.roots).toHaveLength(2);

        const root1 = forest.roots.find((r) => r.id === r1.id);
        const root2 = forest.roots.find((r) => r.id === r2.id);

        expect(root1).toBeDefined();
        expect(root1?.children).toHaveLength(1);
        expect(root2).toBeDefined();
        expect(root2?.children).toHaveLength(0);
      });

      it("should delete an agent", async () => {
        const client = createTestClient();
        const uniqueAgency = `delete-agent-${Date.now()}`;
        await client.createAgency({ name: uniqueAgency });
        const agency = client.agency(uniqueAgency);

        const agent = await agency.spawnAgent({ agentType: "test-agent" });
        expect(agent.id).toBeDefined();

        // Delete it
        const result = await agency.deleteAgent(agent.id);
        expect(result.ok).toBe(true);

        // Verify it's gone
        const { agents } = await agency.listAgents();
        expect(agents.some((a) => a.id === agent.id)).toBe(false);
      });
    });
  });

  describe("CORS", () => {
    it("should handle OPTIONS preflight requests", async () => {
      const res = await SELF.fetch("http://localhost/agencies", {
        method: "OPTIONS",
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });

    it("should add CORS headers to responses", async () => {
      const res = await SELF.fetch("http://localhost/plugins");

      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("error handling", () => {
    it("should return 404 for unknown paths", async () => {
      const res = await SELF.fetch("http://localhost/unknown/path");

      expect(res.status).toBe(404);
    });
  });
});
