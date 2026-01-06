import {
  tool,
  z,
  type AgentPlugin,
  type AgentBlueprint,
  type PluginContext,
} from "agents-hub";
import { getAgentByName } from "agents";

async function agencyFetch(
  ctx: PluginContext,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const agencyId = ctx.agent.info.agencyId;
  if (!agencyId) {
    throw new Error("Agent is not associated with an agency");
  }
  const stub = await getAgentByName(ctx.agent.exports.Agency, agencyId);
  return stub.fetch(new Request(`http://do${path}`, options));
}

async function agentFetch(
  ctx: PluginContext,
  agentId: string,
  path: string,
  options?: RequestInit
): Promise<Response> {
  const stub = await getAgentByName(ctx.agent.exports.HubAgent, agentId);
  return stub.fetch(new Request(`http://do${path}`, options));
}

const BlueprintInputSchema = z.object({
  name: z.string().describe("Blueprint name (alphanumeric with - or _)"),
  description: z.string().describe("Brief description of what agents from this blueprint do"),
  prompt: z.string().describe("The system prompt for agents of this type"),
  capabilities: z.array(z.string()).describe("List of capability tags or plugin/tool names"),
  model: z.string().optional().describe("Optional model override"),
  vars: z.record(z.unknown()).optional().describe("Optional default variables"),
});

const BlueprintUpdateSchema = z.object({
  name: z.string().describe("Name of the blueprint to update"),
  updates: z.object({
    description: z.string().optional(),
    prompt: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    model: z.string().optional(),
    vars: z.record(z.unknown()).optional(),
    status: z.enum(["active", "draft", "disabled"]).optional(),
  }).describe("Fields to update"),
});

const ScheduleInputSchema = z.object({
  name: z.string().describe("Schedule name"),
  agentType: z.string().describe("Blueprint name to spawn"),
  type: z.enum(["once", "cron", "interval"]).describe("Schedule type"),
  runAt: z.string().optional().describe("ISO datetime for one-time schedules"),
  cron: z.string().optional().describe("Cron expression for cron schedules"),
  intervalMs: z.number().optional().describe("Interval in milliseconds"),
  input: z.record(z.unknown()).optional().describe("Input to pass to spawned agent"),
  timezone: z.string().optional().describe("Timezone for cron schedules"),
  maxRetries: z.number().optional().describe("Max retry attempts on failure"),
  overlapPolicy: z.enum(["skip", "queue", "allow"]).optional().describe("What to do if previous run is still active"),
});

const ScheduleUpdateSchema = z.object({
  scheduleId: z.string().describe("Schedule ID to update"),
  updates: z.object({
    name: z.string().optional(),
    agentType: z.string().optional(),
    type: z.enum(["once", "cron", "interval"]).optional(),
    runAt: z.string().optional(),
    cron: z.string().optional(),
    intervalMs: z.number().optional(),
    input: z.record(z.unknown()).optional(),
    timezone: z.string().optional(),
    maxRetries: z.number().optional(),
    overlapPolicy: z.enum(["skip", "queue", "allow"]).optional(),
  }).describe("Fields to update"),
});

export const agencyManagement: AgentPlugin = {
  name: "agency-management",
  tags: ["agency-management"],

  async beforeModel(ctx, plan) {
    try {
      const [blueprintsRes, agentsRes, schedulesRes, varsRes, mcpRes] = await Promise.all([
        agencyFetch(ctx, "/blueprints"),
        agencyFetch(ctx, "/agents"),
        agencyFetch(ctx, "/schedules"),
        agencyFetch(ctx, "/vars"),
        agencyFetch(ctx, "/mcp"),
      ]);

      const combined = new Map<string, AgentBlueprint>();
      const agent = ctx.agent as any;
      if (typeof agent.getStaticBlueprints === "function") {
        for (const bp of agent.getStaticBlueprints()) {
          combined.set(bp.name, bp);
        }
      }
      if (blueprintsRes.ok) {
        const data = (await blueprintsRes.json()) as { blueprints: AgentBlueprint[] };
        for (const bp of data.blueprints) {
          combined.set(bp.name, bp);
        }
      }
      const blueprints = Array.from(combined.values());

      const agents = agentsRes.ok
        ? ((await agentsRes.json()) as { agents: { id: string; agentType: string }[] }).agents
        : [];
      const schedules = schedulesRes.ok
        ? ((await schedulesRes.json()) as { schedules: { id: string; status: string }[] }).schedules
        : [];
      const vars = varsRes.ok
        ? ((await varsRes.json()) as { vars: Record<string, unknown> }).vars
        : {};
      const mcpServers = mcpRes.ok
        ? ((await mcpRes.json()) as { servers: Array<{ id: string; name: string; status: string }> }).servers
        : [];

      const agencyId = ctx.agent.info.agencyId;
      const blueprintNames = blueprints.map((b) => b.name).join(", ") || "none";
      const activeSchedules = schedules.filter((s) => s.status === "active").length;
      const varCount = Object.keys(vars).length;
      const readyMcpServers = mcpServers.filter((s) => s.status === "ready").length;
      const mcpServerNames = mcpServers.map((s) => `${s.name} (${s.status})`).join(", ") || "none";

      const contextBlock = `
## Agency Context

You are the mind of agency **"${agencyId}"**.

| Resource | Count | Details |
|----------|-------|---------|
| Blueprints | ${blueprints.length} | ${blueprintNames} |
| Agents | ${agents.length} | Currently spawned instances |
| Schedules | ${schedules.length} | ${activeSchedules} active |
| Variables | ${varCount} | Agency-level configuration |
| MCP Servers | ${mcpServers.length} | ${readyMcpServers} ready: ${mcpServerNames} |

This context is automatically refreshed each turn.
`;

      plan.addSystemPrompt(contextBlock);
    } catch (err) {
      console.warn("Failed to inject agency context:", err);
    }

    registerTools(ctx);
  },
};

function registerTools(ctx: PluginContext) {
  ctx.registerTool(tool({
    name: "list_blueprints",
    description: "List all blueprints in this agency with their names, descriptions, and status",
    inputSchema: z.object({}),
    execute: async () => {
      const combined = new Map<string, AgentBlueprint>();

      const agent = ctx.agent as any;
      if (typeof agent.getStaticBlueprints === "function") {
        for (const bp of agent.getStaticBlueprints()) {
          combined.set(bp.name, bp);
        }
      }

      const res = await agencyFetch(ctx, "/blueprints");
      if (res.ok) {
        const data = (await res.json()) as { blueprints: AgentBlueprint[] };
        for (const bp of data.blueprints) {
          combined.set(bp.name, bp);
        }
      }

      return Array.from(combined.values()).map((b) => ({
        name: b.name,
        description: b.description,
        status: b.status || "active",
        capabilities: b.capabilities,
        model: b.model,
      }));
    },
  }));

  ctx.registerTool(tool({
    name: "get_blueprint",
    description: "Get full details of a specific blueprint by name",
    inputSchema: z.object({
      name: z.string().describe("Blueprint name"),
    }),
    execute: async ({ name }) => {
      // Check dynamic blueprints first (they override static)
      const res = await agencyFetch(ctx, "/blueprints");
      if (res.ok) {
        const data = (await res.json()) as { blueprints: AgentBlueprint[] };
        const bp = data.blueprints.find((b) => b.name === name);
        if (bp) return bp;
      }

      // Fallback to static blueprints
      const agent = ctx.agent as any;
      if (typeof agent.getStaticBlueprints === "function") {
        const staticBp = agent.getStaticBlueprints().find((b: AgentBlueprint) => b.name === name);
        if (staticBp) return staticBp;
      }

      return `Blueprint "${name}" not found`;
    },
  }));

  ctx.registerTool(tool({
    name: "create_blueprint",
    description: "Create a new blueprint in this agency",
    inputSchema: BlueprintInputSchema,
    execute: async (blueprint) => {
      const res = await agencyFetch(ctx, "/blueprints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(blueprint),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "update_blueprint",
    description: "Update an existing blueprint",
    inputSchema: BlueprintUpdateSchema,
    execute: async ({ name, updates }) => {
      const getRes = await agencyFetch(ctx, "/blueprints");
      if (!getRes.ok) return `Error fetching blueprints: ${getRes.status}`;

      const data = (await getRes.json()) as { blueprints: AgentBlueprint[] };
      const existing = data.blueprints.find((b) => b.name === name);
      if (!existing) return `Blueprint "${name}" not found`;

      const updated = { ...existing, ...updates };

      const res = await agencyFetch(ctx, "/blueprints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return { ok: true, message: `Blueprint "${name}" updated` };
    },
  }));

  ctx.registerTool(tool({
    name: "delete_blueprint",
    description: "Delete a blueprint from this agency",
    inputSchema: z.object({
      name: z.string().describe("Blueprint name to delete"),
    }),
    execute: async ({ name }) => {
      const res = await agencyFetch(ctx, `/blueprints/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return { ok: true, message: `Blueprint "${name}" deleted` };
    },
  }));

  ctx.registerTool(tool({
    name: "list_agents",
    description: "List all agents in this agency with their IDs, types, and creation times",
    inputSchema: z.object({}),
    execute: async () => {
      const res = await agencyFetch(ctx, "/agents");
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      const data = (await res.json()) as { agents: any[] };
      return data.agents.map((a) => ({
        id: a.id,
        agentType: a.agentType,
        createdAt: a.createdAt,
      }));
    },
  }));

  ctx.registerTool(tool({
    name: "get_agent_summary",
    description: "Get summary of a specific agent including its metadata and current run state",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID (UUID)"),
    }),
    execute: async ({ agentId }) => {
      try {
        const res = await agentFetch(ctx, agentId, "/state");
        if (!res.ok) return `Error: ${res.status} ${await res.text()}`;

        const data = (await res.json()) as { state: any; run: any };
        const state = data.state;
        const run = data.run;

        return {
          agentId,
          state: state ? {
            agentType: state.agentType,
            threadId: state.threadId,
            model: state.model,
            messageCount: state.messages?.length || 0,
            toolCount: state.tools?.length || 0,
          } : null,
          run,
        };
      } catch (err) {
        return `Error fetching agent ${agentId}: ${err}`;
      }
    },
  }));

  ctx.registerTool(tool({
    name: "get_agent_conversation",
    description: "Get the conversation history of a specific agent. Can be large - consider using a subagent for deep analysis.",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID (UUID)"),
      limit: z.number().optional().describe("Max messages to return (default: 50)"),
    }),
    execute: async ({ agentId, limit = 50 }) => {
      try {
        const res = await agentFetch(ctx, agentId, "/state");
        if (!res.ok) return `Error: ${res.status} ${await res.text()}`;

        const data = (await res.json()) as { state: { messages?: any[] } };
        const messages = data.state?.messages || [];

        const recent = messages.slice(-limit);
        return {
          agentId,
          totalMessages: messages.length,
          returned: recent.length,
          messages: recent.map((m: any) => ({
            role: m.role,
            content: typeof m.content === "string"
              ? m.content.slice(0, 500) + (m.content.length > 500 ? "..." : "")
              : m.content,
            toolCalls: m.toolCalls?.map((tc: any) => tc.name),
          })),
        };
      } catch (err) {
        return `Error fetching conversation for ${agentId}: ${err}`;
      }
    },
  }));

  ctx.registerTool(tool({
    name: "get_agent_events",
    description: "Get the event trace for a specific agent. Can be large - consider using a subagent for deep analysis.",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID (UUID)"),
      limit: z.number().optional().describe("Max events to return (default: 100)"),
    }),
    execute: async ({ agentId, limit = 100 }) => {
      try {
        const res = await agentFetch(ctx, agentId, "/events");
        if (!res.ok) return `Error: ${res.status} ${await res.text()}`;

        const data = (await res.json()) as { events?: any[] };
        const events = data.events || [];

        const recent = events.slice(-limit);
        return {
          agentId,
          totalEvents: events.length,
          returned: recent.length,
          events: recent.map((e: any) => ({
            type: e.type,
            ts: e.ts,
            data: e.data,
          })),
        };
      } catch (err) {
        return `Error fetching events for ${agentId}: ${err}`;
      }
    },
  }));

  ctx.registerTool(tool({
    name: "spawn_agent",
    description: "Spawn a new agent from a blueprint",
    inputSchema: z.object({
      agentType: z.string().describe("Blueprint name to spawn from"),
      input: z.record(z.unknown()).optional().describe("Optional input to pass to the agent"),
    }),
    execute: async ({ agentType, input }) => {
      const res = await agencyFetch(ctx, "/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentType, input }),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "send_message_to_agent",
    description: "Send a message to an existing agent",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID (UUID)"),
      message: z.string().describe("Message to send"),
    }),
    execute: async ({ agentId, message }) => {
      try {
        const res = await agentFetch(ctx, agentId, "/invoke", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: message }],
          }),
        });
        if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
        return { ok: true, message: `Message sent to agent ${agentId}` };
      } catch (err) {
        return `Error sending message to ${agentId}: ${err}`;
      }
    },
  }));

  ctx.registerTool(tool({
    name: "cancel_agent",
    description: "Cancel a running agent",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID (UUID)"),
    }),
    execute: async ({ agentId }) => {
      try {
        const res = await agentFetch(ctx, agentId, "/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "cancel" }),
        });
        if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
        return { ok: true, message: `Agent ${agentId} canceled` };
      } catch (err) {
        return `Error canceling agent ${agentId}: ${err}`;
      }
    },
  }));

  ctx.registerTool(tool({
    name: "delete_agent",
    description: "Delete an agent and all its resources",
    inputSchema: z.object({
      agentId: z.string().describe("Agent ID (UUID)"),
    }),
    execute: async ({ agentId }) => {
      const res = await agencyFetch(ctx, `/agents/${agentId}`, {
        method: "DELETE",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return { ok: true, message: `Agent ${agentId} deleted` };
    },
  }));

  ctx.registerTool(tool({
    name: "list_schedules",
    description: "List all schedules in this agency",
    inputSchema: z.object({}),
    execute: async () => {
      const res = await agencyFetch(ctx, "/schedules");
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      const data = (await res.json()) as { schedules: any[] };
      return data.schedules.map((s) => ({
        id: s.id,
        name: s.name,
        agentType: s.agentType,
        type: s.type,
        status: s.status,
        nextRunAt: s.nextRunAt,
        lastRunAt: s.lastRunAt,
      }));
    },
  }));

  ctx.registerTool(tool({
    name: "get_schedule",
    description: "Get details of a specific schedule including recent runs",
    inputSchema: z.object({
      scheduleId: z.string().describe("Schedule ID"),
    }),
    execute: async ({ scheduleId }) => {
      const [scheduleRes, runsRes] = await Promise.all([
        agencyFetch(ctx, `/schedules/${scheduleId}`),
        agencyFetch(ctx, `/schedules/${scheduleId}/runs`),
      ]);

      if (!scheduleRes.ok) return `Error: ${scheduleRes.status} ${await scheduleRes.text()}`;

      const schedule = (await scheduleRes.json()) as { schedule: any };
      const runs = runsRes.ok
        ? ((await runsRes.json()) as { runs: any[] }).runs.slice(0, 10)
        : [];

      return {
        schedule: schedule.schedule,
        recentRuns: runs,
      };
    },
  }));

  ctx.registerTool(tool({
    name: "create_schedule",
    description: "Create a new schedule to automatically spawn agents",
    inputSchema: ScheduleInputSchema,
    execute: async (schedule) => {
      const res = await agencyFetch(ctx, "/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(schedule),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "update_schedule",
    description: "Update an existing schedule",
    inputSchema: ScheduleUpdateSchema,
    execute: async ({ scheduleId, updates }) => {
      const res = await agencyFetch(ctx, `/schedules/${scheduleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "delete_schedule",
    description: "Delete a schedule",
    inputSchema: z.object({
      scheduleId: z.string().describe("Schedule ID"),
    }),
    execute: async ({ scheduleId }) => {
      const res = await agencyFetch(ctx, `/schedules/${scheduleId}`, {
        method: "DELETE",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return { ok: true, message: `Schedule ${scheduleId} deleted` };
    },
  }));

  ctx.registerTool(tool({
    name: "pause_schedule",
    description: "Pause a schedule (stops future runs)",
    inputSchema: z.object({
      scheduleId: z.string().describe("Schedule ID"),
    }),
    execute: async ({ scheduleId }) => {
      const res = await agencyFetch(ctx, `/schedules/${scheduleId}/pause`, {
        method: "POST",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "resume_schedule",
    description: "Resume a paused schedule",
    inputSchema: z.object({
      scheduleId: z.string().describe("Schedule ID"),
    }),
    execute: async ({ scheduleId }) => {
      const res = await agencyFetch(ctx, `/schedules/${scheduleId}/resume`, {
        method: "POST",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "trigger_schedule",
    description: "Manually trigger a schedule to run now",
    inputSchema: z.object({
      scheduleId: z.string().describe("Schedule ID"),
    }),
    execute: async ({ scheduleId }) => {
      const res = await agencyFetch(ctx, `/schedules/${scheduleId}/trigger`, {
        method: "POST",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "list_vars",
    description: "List all agency-level variables",
    inputSchema: z.object({}),
    execute: async () => {
      const res = await agencyFetch(ctx, "/vars");
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      const data = (await res.json()) as { vars: Record<string, unknown> };
      return Object.entries(data.vars).map(([key, value]) => ({
        key,
        value: typeof value === "string" && value.length > 100
          ? value.slice(0, 100) + "..."
          : value,
        type: typeof value,
      }));
    },
  }));

  ctx.registerTool(tool({
    name: "get_var",
    description: "Get the value of a specific agency variable",
    inputSchema: z.object({
      key: z.string().describe("Variable key"),
    }),
    execute: async ({ key }) => {
      const res = await agencyFetch(ctx, `/vars/${encodeURIComponent(key)}`);
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));

  ctx.registerTool(tool({
    name: "set_var",
    description: "Set an agency-level variable",
    inputSchema: z.object({
      key: z.string().describe("Variable key"),
      value: z.unknown().describe("Variable value"),
    }),
    execute: async ({ key, value }) => {
      const res = await agencyFetch(ctx, `/vars/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return { ok: true, message: `Variable "${key}" set` };
    },
  }));

  ctx.registerTool(tool({
    name: "delete_var",
    description: "Delete an agency-level variable",
    inputSchema: z.object({
      key: z.string().describe("Variable key"),
    }),
    execute: async ({ key }) => {
      const res = await agencyFetch(ctx, `/vars/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return { ok: true, message: `Variable "${key}" deleted` };
    },
  }));

  ctx.registerTool(tool({
    name: "list_capabilities",
    description: `List all available plugins and tools that can be used in blueprint capabilities.
Returns plugin names, tool names, their tags, descriptions, and required vars.
Use this to understand what capabilities exist when creating or updating blueprints.`,
    inputSchema: z.object({}),
    execute: async () => {
      const agent = ctx.agent as any;

      let plugins: Array<{ name: string; tags: string[]; varHints?: Array<{ name: string; required?: boolean; description?: string }> }> = [];
      let tools: Array<{ name: string; description?: string; tags: string[]; varHints?: Array<{ name: string; required?: boolean; description?: string }> }> = [];

      if (typeof agent.getRegisteredPlugins === "function") {
        plugins = agent.getRegisteredPlugins();
      }
      if (typeof agent.getRegisteredTools === "function") {
        tools = agent.getRegisteredTools();
      }

      return {
        plugins: plugins.map((p) => ({
          name: p.name,
          tags: p.tags,
          varHints: p.varHints,
          usage: `Add "${p.name}" to capabilities array`,
        })),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          tags: t.tags,
          varHints: t.varHints,
          usage: t.tags.length > 0
            ? `Add "${t.name}" or "@${t.tags[0]}" to capabilities array`
            : `Add "${t.name}" to capabilities array`,
        })),
        hint: "Capabilities can be plugin names, tool names, or @tag to include all tools/plugins with that tag",
      };
    },
  }));

  // ============================================================
  // MCP Server Management Tools
  // ============================================================

  ctx.registerTool(tool({
    name: "list_mcp_servers",
    description: "List all MCP servers connected to this agency with their status",
    inputSchema: z.object({}),
    execute: async () => {
      const res = await agencyFetch(ctx, "/mcp");
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      const data = (await res.json()) as { servers: Array<{ id: string; name: string; url: string; status: string; error?: string }> };
      return data.servers.map((s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        status: s.status,
        error: s.error,
      }));
    },
  }));

  ctx.registerTool(tool({
    name: "add_mcp_server",
    description: "Add a new MCP server to this agency. Returns the server config. If status is 'authenticating', the authUrl needs to be opened for OAuth.",
    inputSchema: z.object({
      name: z.string().describe("Display name for the server"),
      url: z.string().describe("MCP server URL (e.g., https://mcp.github.com/sse)"),
      token: z.string().optional().describe("Optional bearer token for API key authentication"),
    }),
    execute: async ({ name, url, token }) => {
      const body: { name: string; url: string; headers?: Record<string, string> } = { name, url };
      if (token) {
        body.headers = { Authorization: `Bearer ${token}` };
      }
      const res = await agencyFetch(ctx, "/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      const data = (await res.json()) as { server: { id: string; name: string; status: string; authUrl?: string } };
      if (data.server.status === "authenticating" && data.server.authUrl) {
        return {
          ...data.server,
          message: `Server requires OAuth authentication. Direct the user to open this URL: ${data.server.authUrl}`,
        };
      }
      return data.server;
    },
  }));

  ctx.registerTool(tool({
    name: "remove_mcp_server",
    description: "Remove an MCP server from this agency",
    inputSchema: z.object({
      serverId: z.string().describe("Server ID to remove"),
    }),
    execute: async ({ serverId }) => {
      const res = await agencyFetch(ctx, `/mcp/${encodeURIComponent(serverId)}`, {
        method: "DELETE",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return { ok: true, message: `MCP server ${serverId} removed` };
    },
  }));

  ctx.registerTool(tool({
    name: "retry_mcp_server",
    description: "Retry connecting to a failed MCP server",
    inputSchema: z.object({
      serverId: z.string().describe("Server ID to retry"),
    }),
    execute: async ({ serverId }) => {
      const res = await agencyFetch(ctx, `/mcp/${encodeURIComponent(serverId)}/retry`, {
        method: "POST",
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      const data = (await res.json()) as { server: { id: string; name: string; status: string; authUrl?: string } };
      if (data.server.status === "authenticating" && data.server.authUrl) {
        return {
          ...data.server,
          message: `Server requires OAuth authentication. Direct the user to open this URL: ${data.server.authUrl}`,
        };
      }
      return data.server;
    },
  }));

  ctx.registerTool(tool({
    name: "list_mcp_tools",
    description: "List all tools available from connected MCP servers (only from servers in 'ready' state)",
    inputSchema: z.object({
      serverId: z.string().optional().describe("Optional: filter tools by server ID"),
    }),
    execute: async ({ serverId }) => {
      const res = await agencyFetch(ctx, "/mcp/tools");
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      const data = (await res.json()) as { tools: Array<{ serverId: string; name: string; description?: string; inputSchema?: unknown }> };
      let tools = data.tools;
      if (serverId) {
        tools = tools.filter((t) => t.serverId === serverId);
      }
      return tools.map((t) => ({
        serverId: t.serverId,
        name: t.name,
        description: t.description,
      }));
    },
  }));

  ctx.registerTool(tool({
    name: "call_mcp_tool",
    description: "Call a tool from a connected MCP server. The server must be in 'ready' state.",
    inputSchema: z.object({
      serverId: z.string().describe("MCP server ID"),
      toolName: z.string().describe("Name of the tool to call"),
      arguments: z.record(z.unknown()).optional().describe("Arguments to pass to the tool"),
    }),
    execute: async ({ serverId, toolName, arguments: args }) => {
      const res = await agencyFetch(ctx, "/mcp/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serverId,
          toolName,
          arguments: args || {},
        }),
      });
      if (!res.ok) return `Error: ${res.status} ${await res.text()}`;
      return res.json();
    },
  }));
}

export default agencyManagement;
