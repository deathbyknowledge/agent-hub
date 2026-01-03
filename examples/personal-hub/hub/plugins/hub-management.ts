/**
 * Hub Management Plugin
 *
 * Provides tools for introspecting and managing the entire hub.
 * Used by the Hub Mind to have awareness and control over all agencies.
 *
 * Tools:
 * - list_agencies: List all agencies in the hub
 * - get_agency_summary: Get summary of a specific agency
 * - create_agency: Create a new agency
 * - delete_agency: Delete an agency
 * - get_hub_stats: Get overall hub statistics
 *
 * The plugin also injects hub context into the system prompt via beforeModel.
 */
import {
  tool,
  z,
  type AgentPlugin,
  type PluginContext,
} from "agent-hub";

// ============================================================================
// Helper: Fetch from Hub
// ============================================================================

/**
 * Fetch from the hub's HTTP API.
 * The hub worker exposes /agencies and related endpoints.
 */
async function hubFetch(
  ctx: PluginContext,
  path: string,
  options?: RequestInit
): Promise<Response> {
  // We need to call the external worker API
  // The agent has access to env which may have the secret
  const secret = ctx.agent.vars.HUB_SECRET as string | undefined;
  const baseUrl = ctx.agent.vars.HUB_BASE_URL as string | undefined;

  if (!baseUrl) {
    throw new Error("HUB_BASE_URL var not set - Hub Mind cannot access hub API");
  }

  const url = new URL(path, baseUrl);
  if (secret) {
    url.searchParams.set("key", secret);
  }

  return fetch(url.toString(), options);
}

/**
 * Fetch agency details via the hub API.
 */
async function agencyFetch(
  ctx: PluginContext,
  agencyId: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  return hubFetch(ctx, `/agency/${agencyId}${path}`, options);
}

// ============================================================================
// Plugin Definition
// ============================================================================

export const hubManagement: AgentPlugin = {
  name: "hub-management",
  tags: ["hub-management"],

  varHints: [
    { name: "HUB_BASE_URL", required: true, description: "Base URL of the hub API" },
    { name: "HUB_SECRET", required: false, description: "Secret key for hub API authentication" },
  ],

  async beforeModel(ctx, plan) {
    // Inject hub context into system prompt
    try {
      const res = await hubFetch(ctx, "/agencies");
      if (!res.ok) {
        console.warn("Failed to fetch agencies for hub context:", res.status);
        return;
      }

      const data = (await res.json()) as { agencies: Array<{ id: string; name: string }> };
      const agencies = data.agencies || [];

      const agencyNames = agencies.map((a) => a.name || a.id).join(", ") || "none";

      const contextBlock = `
## Hub Context

You are the Hub Mind - the top-level intelligence managing this Agent Hub.

| Resource | Count | Details |
|----------|-------|---------|
| Agencies | ${agencies.length} | ${agencyNames} |

You have oversight of all agencies and can help users understand the hub structure,
create new agencies, and provide guidance on using the system.

This context is automatically refreshed each turn.
`;

      plan.addSystemPrompt(contextBlock);
    } catch (err) {
      console.warn("Failed to inject hub context:", err);
    }

    // Register all tools
    registerTools(ctx);
  },
};

// ============================================================================
// Tool Registration
// ============================================================================

function registerTools(ctx: PluginContext) {
  // -------------------------------------------------------------------------
  // Agencies - Read
  // -------------------------------------------------------------------------

  ctx.registerTool(tool({
    name: "list_agencies",
    description: "List all agencies in the hub with their names and IDs",
    inputSchema: z.object({}),
    execute: async () => {
      const res = await hubFetch(ctx, "/agencies");
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      const data = (await res.json()) as { agencies: Array<{ id: string; name: string; createdAt?: string }> };
      return data.agencies.map((a) => ({
        id: a.id,
        name: a.name,
        createdAt: a.createdAt,
      }));
    },
  }));

  ctx.registerTool(tool({
    name: "get_agency_summary",
    description: "Get summary of a specific agency including its blueprints, agents, and schedules",
    inputSchema: z.object({
      agencyId: z.string().describe("Agency ID"),
    }),
    execute: async ({ agencyId }) => {
      try {
        const [blueprintsRes, agentsRes, schedulesRes] = await Promise.all([
          agencyFetch(ctx, agencyId, "/blueprints"),
          agencyFetch(ctx, agencyId, "/agents"),
          agencyFetch(ctx, agencyId, "/schedules"),
        ]);

        const blueprints = blueprintsRes.ok
          ? ((await blueprintsRes.json()) as { blueprints: Array<{ name: string }> }).blueprints
          : [];
        const agents = agentsRes.ok
          ? ((await agentsRes.json()) as { agents: Array<{ id: string; agentType: string }> }).agents
          : [];
        const schedules = schedulesRes.ok
          ? ((await schedulesRes.json()) as { schedules: Array<{ id: string; status: string }> }).schedules
          : [];

        return {
          agencyId,
          blueprintCount: blueprints.length,
          blueprintNames: blueprints.map((b) => b.name),
          agentCount: agents.length,
          agents: agents.map((a) => ({ id: a.id, type: a.agentType })),
          scheduleCount: schedules.length,
          activeSchedules: schedules.filter((s) => s.status === "active").length,
        };
      } catch (err) {
        return `Error fetching agency ${agencyId}: ${err}`;
      }
    },
  }));

  ctx.registerTool(tool({
    name: "get_hub_stats",
    description: "Get overall statistics about the hub",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const res = await hubFetch(ctx, "/agencies");
        if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
        
        const data = (await res.json()) as { agencies: Array<{ id: string; name: string }> };
        const agencies = data.agencies || [];

        // Gather stats from each agency
        let totalAgents = 0;
        let totalBlueprints = 0;
        let totalSchedules = 0;
        const agencyStats: Array<{ id: string; agents: number; blueprints: number }> = [];

        for (const agency of agencies) {
          try {
            const [agentsRes, blueprintsRes] = await Promise.all([
              agencyFetch(ctx, agency.id, "/agents"),
              agencyFetch(ctx, agency.id, "/blueprints"),
            ]);

            const agentCount = agentsRes.ok
              ? ((await agentsRes.json()) as { agents: unknown[] }).agents.length
              : 0;
            const blueprintCount = blueprintsRes.ok
              ? ((await blueprintsRes.json()) as { blueprints: unknown[] }).blueprints.length
              : 0;

            totalAgents += agentCount;
            totalBlueprints += blueprintCount;
            agencyStats.push({ id: agency.id, agents: agentCount, blueprints: blueprintCount });
          } catch {
            // Skip agencies that fail
          }
        }

        return {
          agencyCount: agencies.length,
          totalAgents,
          totalBlueprints,
          totalSchedules,
          agencyStats,
        };
      } catch (err) {
        return `Error fetching hub stats: ${err}`;
      }
    },
  }));

  // -------------------------------------------------------------------------
  // Agencies - Write
  // -------------------------------------------------------------------------

  ctx.registerTool(tool({
    name: "create_agency",
    description: "Create a new agency in the hub",
    inputSchema: z.object({
      name: z.string().describe("Agency name (alphanumeric with dashes/underscores)"),
    }),
    execute: async ({ name }) => {
      const res = await hubFetch(ctx, "/agencies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "delete_agency",
    description: "Delete an agency and all its resources. Use with caution!",
    inputSchema: z.object({
      agencyId: z.string().describe("Agency ID to delete"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    }),
    execute: async ({ agencyId, confirm }) => {
      if (!confirm) {
        return "Deletion not confirmed. Set confirm=true to proceed.";
      }
      const res = await agencyFetch(ctx, agencyId, "/destroy", {
        method: "DELETE",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return { ok: true, message: `Agency "${agencyId}" deleted` };
    },
  }));

  // -------------------------------------------------------------------------
  // Cross-Agency Operations
  // -------------------------------------------------------------------------

  ctx.registerTool(tool({
    name: "spawn_agent_in_agency",
    description: "Spawn a new agent in a specific agency",
    inputSchema: z.object({
      agencyId: z.string().describe("Agency ID"),
      agentType: z.string().describe("Blueprint name to spawn from"),
    }),
    execute: async ({ agencyId, agentType }) => {
      const res = await agencyFetch(ctx, agencyId, "/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentType }),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));
}

export default hubManagement;
