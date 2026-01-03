import { env } from "cloudflare:test";
import { describe, expect, it, beforeEach } from "vitest";
import { getAgentByName } from "agents";
import type { Env } from "./worker";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

describe("Agency", () => {
  describe("blueprints", () => {
    it("should list blueprints (initially empty from DB)", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-blueprints");

      const res = await agencyStub.fetch(
        new Request("http://do/blueprints", { method: "GET" })
      );

      expect(res.ok).toBe(true);
      const data = await res.json() as { blueprints: unknown[] };
      expect(data.blueprints).toEqual([]);
    });

    it("should create a blueprint", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-create-bp");

      const blueprint = {
        name: "my-agent",
        description: "A test agent",
        prompt: "You are a helpful assistant.",
        capabilities: ["@default"],
      };

      const res = await agencyStub.fetch(
        new Request("http://do/blueprints", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(blueprint),
        })
      );

      expect(res.ok).toBe(true);
      const data = await res.json() as { ok: boolean; name: string };
      expect(data.ok).toBe(true);
      expect(data.name).toBe("my-agent");

      // Verify it's in the list
      const listRes = await agencyStub.fetch(
        new Request("http://do/blueprints", { method: "GET" })
      );
      const listData = await listRes.json() as { blueprints: Array<{ name: string }> };
      expect(listData.blueprints).toHaveLength(1);
      expect(listData.blueprints[0].name).toBe("my-agent");
    });

    it("should validate blueprint name", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-validate-bp");

      const invalidBlueprint = {
        name: "invalid name with spaces",
        prompt: "test",
        capabilities: [],
      };

      const res = await agencyStub.fetch(
        new Request("http://do/blueprints", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(invalidBlueprint),
        })
      );

      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
    });

    it("should delete a blueprint", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-delete-bp");

      // Create first
      await agencyStub.fetch(
        new Request("http://do/blueprints", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "to-delete",
            prompt: "test",
            capabilities: [],
          }),
        })
      );

      // Delete
      const deleteRes = await agencyStub.fetch(
        new Request("http://do/blueprints/to-delete", { method: "DELETE" })
      );

      expect(deleteRes.ok).toBe(true);

      // Verify it's gone
      const listRes = await agencyStub.fetch(
        new Request("http://do/blueprints", { method: "GET" })
      );
      const listData = await listRes.json() as { blueprints: unknown[] };
      expect(listData.blueprints).toHaveLength(0);
    });
  });

  describe("agents", () => {
    it("should list agents (initially empty)", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-list-agents");

      const res = await agencyStub.fetch(
        new Request("http://do/agents", { method: "GET" })
      );

      expect(res.ok).toBe(true);
      const data = await res.json() as { agents: unknown[] };
      expect(data.agents).toEqual([]);
    });

    it("should spawn an agent from a static blueprint", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-spawn");

      const res = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );

      expect(res.ok).toBe(true);
      expect(res.status).toBe(201);

      const data = await res.json() as { id: string; agentType: string };
      expect(data.id).toBeDefined();
      expect(data.agentType).toBe("test-agent");

      // Verify it's in the list
      const listRes = await agencyStub.fetch(
        new Request("http://do/agents", { method: "GET" })
      );
      const listData = await listRes.json() as { agents: Array<{ id: string }> };
      expect(listData.agents).toHaveLength(1);
      expect(listData.agents[0].id).toBe(data.id);
    });

    it("should delete an agent", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-delete-agent");

      // Spawn first
      const spawnRes = await agencyStub.fetch(
        new Request("http://do/agents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentType: "test-agent" }),
        })
      );
      const spawnData = await spawnRes.json() as { id: string };

      // Delete
      const deleteRes = await agencyStub.fetch(
        new Request(`http://do/agents/${spawnData.id}`, { method: "DELETE" })
      );

      expect(deleteRes.ok).toBe(true);

      // Verify it's gone
      const listRes = await agencyStub.fetch(
        new Request("http://do/agents", { method: "GET" })
      );
      const listData = await listRes.json() as { agents: unknown[] };
      expect(listData.agents).toHaveLength(0);
    });
  });

  describe("vars", () => {
    it("should get empty vars initially", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-vars-empty");

      const res = await agencyStub.fetch(
        new Request("http://do/vars", { method: "GET" })
      );

      expect(res.ok).toBe(true);
      const data = await res.json() as { vars: Record<string, unknown> };
      expect(data.vars).toEqual({});
    });

    it("should set and get vars", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-vars-set");

      // Set vars
      const setRes = await agencyStub.fetch(
        new Request("http://do/vars", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ API_KEY: "test-key", TIMEOUT: 5000 }),
        })
      );

      expect(setRes.ok).toBe(true);

      // Get vars
      const getRes = await agencyStub.fetch(
        new Request("http://do/vars", { method: "GET" })
      );
      const data = await getRes.json() as { vars: Record<string, unknown> };
      expect(data.vars.API_KEY).toBe("test-key");
      expect(data.vars.TIMEOUT).toBe(5000);
    });

    it("should set and get a single var", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-vars-single");

      // Set a single var
      await agencyStub.fetch(
        new Request("http://do/vars/MY_VAR", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "hello" }),
        })
      );

      // Get it back
      const getRes = await agencyStub.fetch(
        new Request("http://do/vars/MY_VAR", { method: "GET" })
      );
      const data = await getRes.json() as { key: string; value: unknown };
      expect(data.key).toBe("MY_VAR");
      expect(data.value).toBe("hello");
    });

    it("should delete a var", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-vars-delete");

      // Set a var
      await agencyStub.fetch(
        new Request("http://do/vars/TO_DELETE", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "bye" }),
        })
      );

      // Delete it
      const deleteRes = await agencyStub.fetch(
        new Request("http://do/vars/TO_DELETE", { method: "DELETE" })
      );
      expect(deleteRes.ok).toBe(true);

      // Verify it's gone
      const getRes = await agencyStub.fetch(
        new Request("http://do/vars/TO_DELETE", { method: "GET" })
      );
      const data = await getRes.json() as { value: unknown };
      expect(data.value).toBeUndefined();
    });
  });

  describe("schedules", () => {
    it("should list schedules (initially empty)", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-schedules-empty");

      const res = await agencyStub.fetch(
        new Request("http://do/schedules", { method: "GET" })
      );

      expect(res.ok).toBe(true);
      const data = await res.json() as { schedules: unknown[] };
      expect(data.schedules).toEqual([]);
    });

    it("should create a one-time schedule", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-schedule-once");

      const futureDate = new Date(Date.now() + 60000).toISOString();
      const schedule = {
        name: "test-once",
        agentType: "test-agent",
        type: "once",
        runAt: futureDate,
      };

      const res = await agencyStub.fetch(
        new Request("http://do/schedules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(schedule),
        })
      );

      expect(res.ok).toBe(true);
      expect(res.status).toBe(201);

      const data = await res.json() as { schedule: { id: string; name: string; status: string } };
      expect(data.schedule.id).toBeDefined();
      expect(data.schedule.name).toBe("test-once");
      expect(data.schedule.status).toBe("active");
    });

    it("should create a cron schedule", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-schedule-cron");

      const schedule = {
        name: "test-cron",
        agentType: "test-agent",
        type: "cron",
        cron: "0 9 * * *", // Every day at 9am
      };

      const res = await agencyStub.fetch(
        new Request("http://do/schedules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(schedule),
        })
      );

      expect(res.ok).toBe(true);
      const data = await res.json() as { schedule: { nextRunAt: string } };
      expect(data.schedule.nextRunAt).toBeDefined();
    });

    it("should pause and resume a schedule", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-schedule-pause");

      // Create schedule
      const createRes = await agencyStub.fetch(
        new Request("http://do/schedules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "pausable",
            agentType: "test-agent",
            type: "interval",
            intervalMs: 60000,
          }),
        })
      );
      const createData = await createRes.json() as { schedule: { id: string } };
      const scheduleId = createData.schedule.id;

      // Pause
      const pauseRes = await agencyStub.fetch(
        new Request(`http://do/schedules/${scheduleId}/pause`, { method: "POST" })
      );
      expect(pauseRes.ok).toBe(true);
      const pauseData = await pauseRes.json() as { schedule: { status: string } };
      expect(pauseData.schedule.status).toBe("paused");

      // Resume
      const resumeRes = await agencyStub.fetch(
        new Request(`http://do/schedules/${scheduleId}/resume`, { method: "POST" })
      );
      expect(resumeRes.ok).toBe(true);
      const resumeData = await resumeRes.json() as { schedule: { status: string } };
      expect(resumeData.schedule.status).toBe("active");
    });

    it("should delete a schedule", async () => {
      const agencyStub = await getAgentByName(env.AGENCY, "test-agency-schedule-delete");

      // Create schedule
      const createRes = await agencyStub.fetch(
        new Request("http://do/schedules", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "to-delete",
            agentType: "test-agent",
            type: "interval",
            intervalMs: 60000,
          }),
        })
      );
      const createData = await createRes.json() as { schedule: { id: string } };

      // Delete
      const deleteRes = await agencyStub.fetch(
        new Request(`http://do/schedules/${createData.schedule.id}`, { method: "DELETE" })
      );
      expect(deleteRes.ok).toBe(true);

      // Verify it's gone
      const listRes = await agencyStub.fetch(
        new Request("http://do/schedules", { method: "GET" })
      );
      const listData = await listRes.json() as { schedules: unknown[] };
      expect(listData.schedules).toHaveLength(0);
    });
  });
});
