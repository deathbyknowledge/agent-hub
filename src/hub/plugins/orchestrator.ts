/**
 * Orchestrator Plugin
 *
 * Enables dynamic agent composition. Injects available capabilities
 * into system prompt and provides spawn_agent tool for custom blueprints.
 * 
 * This allows a "meta-agent" to dynamically compose specialist agents
 * with exactly the capabilities needed for each task, rather than
 * relying on pre-defined agent blueprints.
 */
import {
  definePlugin,
  tool,
  z,
  AgentEventType,
  type AgentEnv,
} from "@runtime";
import { getAgentByName } from "agents";

type CapabilityInfo = {
  name: string;
  description: string;
  type: "tool" | "plugin";
  tags?: string[];
};

type OrchestratorConfig = {
  orchestrator?: {
    /** List of available capabilities that can be assigned to dynamic agents */
    capabilities: CapabilityInfo[];
  };
};

function formatCapabilities(caps: CapabilityInfo[]): string {
  const tools = caps.filter((c) => c.type === "tool");
  const plugins = caps.filter((c) => c.type === "plugin");

  let out = "";

  if (tools.length) {
    out += "### Tools\n";
    out += tools.map((t) => `- **${t.name}**: ${t.description}`).join("\n");
    out += "\n\n";
  }

  if (plugins.length) {
    out += "### Plugins (capability bundles)\n";
    out += plugins
      .map(
        (p) =>
          `- **${p.name}**: ${p.description}${p.tags?.length ? ` [tags: ${p.tags.join(", ")}]` : ""}`
      )
      .join("\n");
  }

  return out;
}

export const orchestrator = definePlugin<OrchestratorConfig>({
  name: "orchestrator",

  async onInit(ctx) {
    // Create tracking table for dynamic agents
    ctx.agent.store.sql.exec(`
      CREATE TABLE IF NOT EXISTS mw_dynamic_agents (
        child_thread_id TEXT PRIMARY KEY,
        blueprint_name TEXT,
        token TEXT,
        tool_call_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('waiting','completed','canceled')),
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        result TEXT
      );
    `);
  },

  actions: {
    /**
     * Handle dynamic agent completion report
     */
    async dynamic_agent_result(ctx, payload: unknown) {
      const { token, childThreadId, report } = payload as {
        token: string;
        childThreadId: string;
        report?: string;
      };

      const sql = ctx.agent.store.sql;

      const rows = sql
        .exec(
          `SELECT tool_call_id FROM mw_dynamic_agents WHERE token = ? AND child_thread_id = ?`,
          token,
          childThreadId
        )
        .toArray();

      if (!rows.length) throw new Error("Unknown token");

      const toolCallId = String(rows[0].tool_call_id);

      sql.exec(
        `UPDATE mw_dynamic_agents SET status='completed', completed_at=?, result=? WHERE child_thread_id = ?`,
        Date.now(),
        report ?? null,
        childThreadId
      );

      // Append tool result with agentId for potential follow-up
      ctx.agent.store.appendToolResult(
        toolCallId,
        JSON.stringify({ agentId: childThreadId, result: report ?? "" })
      );

      // Check if all dynamic agents are done
      const remaining = sql
        .exec(
          `SELECT COUNT(*) as c FROM mw_dynamic_agents WHERE status = 'waiting'`
        )
        .toArray();

      if (Number(remaining[0]?.c ?? 0) === 0) {
        ctx.agent.runState.status = "running";
        ctx.agent.runState.reason = undefined;
        ctx.agent.emit(AgentEventType.RUN_RESUMED, {});
        await ctx.agent.ensureScheduled();
      }

      return { ok: true };
    },

    /**
     * Cancel all waiting dynamic agents
     */
    async cancel_dynamic_agents(ctx) {
      const sql = ctx.agent.store.sql;
      const waiters = sql
        .exec(
          `SELECT child_thread_id FROM mw_dynamic_agents WHERE status = 'waiting'`
        )
        .toArray();

      for (const w of waiters) {
        try {
          const childAgent = await getAgentByName(
            (ctx.env as AgentEnv).HUB_AGENT,
            String(w.child_thread_id)
          );
          await childAgent.fetch(
            new Request("http://do/action", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ type: "cancel" }),
            })
          );
        } catch (e) {
          console.error(`Failed to cancel dynamic agent ${w.child_thread_id}:`, e);
        }

        sql.exec(
          `UPDATE mw_dynamic_agents SET status='canceled', completed_at=? WHERE child_thread_id = ?`,
          Date.now(),
          String(w.child_thread_id)
        );
      }

      return { ok: true };
    },
  },

  state(ctx) {
    const sql = ctx.agent.store.sql;
    const rows = sql
      .exec(
        `SELECT child_thread_id, blueprint_name, status, created_at, completed_at 
         FROM mw_dynamic_agents ORDER BY created_at ASC`
      )
      .toArray();

    return {
      dynamicAgents: rows.map((r) => ({
        childThreadId: String(r.child_thread_id),
        blueprintName: r.blueprint_name ? String(r.blueprint_name) : undefined,
        status: String(r.status),
        createdAt: Number(r.created_at),
        completedAt: r.completed_at ? Number(r.completed_at) : undefined,
      })),
    };
  },

  async beforeModel(ctx, plan) {
    const config = ctx.agent.config as OrchestratorConfig;
    const capabilities = config.orchestrator?.capabilities ?? [];

    // Inject capabilities list into system prompt
    if (capabilities.length) {
      plan.addSystemPrompt(`## Dynamic Agent Composition

You can create custom agents with exactly the capabilities needed for each task using the \`spawn_agent\` tool.

### Available Capabilities

${formatCapabilities(capabilities)}

When spawning agents:
- **Be minimal**: Only include capabilities the task actually needs
- **Be specific**: Write focused prompts tailored to the exact task
- **Prefer parallelism**: Spawn multiple agents concurrently for independent tasks
- Use capability names directly or @tags to include groups (e.g., "@code" for all code-related tools)`);
    }

    // Register spawn_agent tool
    const spawnAgentTool = tool({
      name: "spawn_agent",
      description: `Create and spawn a custom agent with a tailored blueprint.
Use this to dynamically compose an agent with exactly the capabilities needed for a task.
Design a focused system prompt and select only the necessary capabilities.

The agent will run to completion and return its final response. You can send follow-up
messages to the same agent using message_agent with the returned agentId.`,
      inputSchema: z.object({
        name: z
          .string()
          .describe("Short name for this agent (for logging/debugging)"),
        prompt: z
          .string()
          .describe(
            "System prompt defining the agent's role, behavior, and expected output format"
          ),
        capabilities: z
          .array(z.string())
          .describe(
            "List of tool/plugin names or @tags to include (e.g., ['web_search', '@code'])"
          ),
        task: z.string().describe("Initial task/message for the agent"),
        model: z
          .string()
          .optional()
          .describe("Optional model override (e.g., 'gpt-4o', 'claude-3-opus')"),
      }),
      execute: async ({ name, prompt, capabilities: caps, task, model }, toolCtx) => {
        const token = crypto.randomUUID();
        const childId = crypto.randomUUID();
        const sql = ctx.agent.store.sql;

        const blueprint = {
          name: `dynamic-${name}`,
          prompt,
          capabilities: caps,
          model,
        };

        // Spawn the agent
        const agent = await getAgentByName(
          (toolCtx.env as AgentEnv).HUB_AGENT,
          childId
        );

        // Register with dynamic blueprint passed directly
        const initRes = await agent.fetch(
          new Request("http://do/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: childId,
              createdAt: new Date().toISOString(),
              agentType: blueprint.name,
              request: ctx.agent.info.request,
              agencyId: ctx.agent.info.agencyId,
              // Dynamic blueprint - agent will use this directly
              blueprint,
            }),
          })
        );

        if (!initRes.ok) {
          const err = await initRes.text();
          return `Error: Failed to initialize agent - ${err}`;
        }

        // Invoke with task and parent info
        const res = await agent.fetch(
          new Request("http://do/invoke", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: task }],
              vars: {
                ...ctx.agent.vars,
                parent: {
                  threadId: ctx.agent.info.threadId,
                  token,
                  action: "dynamic_agent_result", // Use our custom action
                },
              },
            }),
          })
        );

        if (!res.ok) {
          return "Error: Failed to spawn agent";
        }

        // Track the dynamic agent
        sql.exec(
          `INSERT INTO mw_dynamic_agents 
           (child_thread_id, blueprint_name, token, tool_call_id, status, created_at)
           VALUES (?, ?, ?, ?, 'waiting', ?)`,
          childId,
          blueprint.name,
          token,
          toolCtx.callId,
          Date.now()
        );

        // Pause parent while waiting
        ctx.agent.runState.status = "paused";
        ctx.agent.runState.reason = "dynamic_agent";
        ctx.agent.emit(AgentEventType.RUN_PAUSED, { reason: "dynamic_agent" });

        return null; // Result comes via dynamic_agent_result action
      },
    });

    ctx.registerTool(spawnAgentTool);
  },

  tags: ["orchestrator", "composer", "meta"],
});
