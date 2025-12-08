import type { AgentMiddleware, ToolCall, Todo } from "../types";
import { TASK_SYSTEM_PROMPT, TASK_TOOL_DESCRIPTION } from "./prompts";
import { TaskParams } from "./schemas";
import { AgentEventType } from "../events";
import { getAgentByName } from "agents";
import type { AgentEnv } from "..";
import { tool } from "./tools";

export function defineMiddleware<TConfig>(
  mw: Omit<AgentMiddleware<TConfig>, "__configType">
): AgentMiddleware<TConfig> {
  return mw as AgentMiddleware<TConfig>;
}

/* -------------------- Subagents: task -------------------- */

/** Lightweight subagent reference - only name/description needed for routing */
export type SubagentRef = {
  name: string;
  description: string;
};

export type SubagentsConfig = {
  subagents?: {
    subagents: SubagentRef[];
  };
};

function renderOtherAgents(subagents: SubagentRef[]) {
  return subagents.length
    ? subagents.map((a) => `- ${a.name}: ${a.description}`).join("\n")
    : "- general-purpose: General-purpose agent for complex tasks (inherits main tools)";
}

export const subagents = defineMiddleware<SubagentsConfig>({
  name: "subagents",
  async beforeModel(ctx, plan) {
    plan.addSystemPrompt(TASK_SYSTEM_PROMPT);
    const config = ctx.agent.config as SubagentsConfig;
    const otherAgents = renderOtherAgents(config.subagents?.subagents ?? []);
    const taskDesc = TASK_TOOL_DESCRIPTION.replace(
      "{other_agents}",
      otherAgents
    );
    const task = tool({
      name: "task",
      description: taskDesc,
      inputSchema: TaskParams,
      execute: async (p, ctx) => {
        const { description, subagentType } = p;
        const token = crypto.randomUUID();
        const childId = crypto.randomUUID();

        // Spawn child
        const subagent = await getAgentByName(
          (ctx.env as AgentEnv).HUB_AGENT,
          childId
        );

        // This ensures the subagent knows what "type" it is (tools, prompt)
        // before it tries to run.
        const initRes = await subagent.fetch(
          new Request("http://do/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: childId,
              createdAt: new Date().toISOString(),
              agentType: subagentType, // Pass the requested type here
              request: ctx.agent.info.request, // Pass down request context (IP, etc)
              agencyId: ctx.agent.info.agencyId, // Required for blueprint lookup
              parent: {
                threadId: ctx.agent.info.threadId,
                token,
              },
            }),
          })
        );

        if (!initRes.ok) return "Error: Failed to initialize subagent";

        const res = await subagent.fetch(
          new Request("http://do/invoke", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "user", content: String(description ?? "") }],
            }),
          })
        );

        if (!res.ok) {
          // Spawn failed, return error immediately
          return "Error: Failed to spawn subagent";
        }

        // Fire SUBAGENT_SPAWNED event
        ctx.agent.emit(AgentEventType.SUBAGENT_SPAWNED, {
          childThreadId: childId,
          agentType: subagentType,
        });

        // Register waiter ONLY after successful spawn
        const w = {
          token,
          childThreadId: childId,
          toolCallId: ctx.callId,
        };
        ctx.agent.store.pushWaitingSubagent(w);

        const runState = ctx.agent.runState;
        if (runState && runState.status === "running") {
          runState.status = "paused";
          runState.reason = "subagent";
          ctx.agent.emit(AgentEventType.RUN_PAUSED, {
            runId: runState.runId,
            reason: "subagent",
          });
        }

        return null; // Won't immediately get added as a tool result
      },
    });
    ctx.registerTool(task);
  },
  tags: ["subagents"],
});

export type HitlConfig = {
  hitl?: {
    tools: string[];
  };
};

export const hitl = defineMiddleware<HitlConfig>({
  name: "hitl",
  async onModelResult(ctx, res) {
    const runState = ctx.agent.runState;
    const last = res.message;
    const calls =
      last?.role === "assistant" && "toolCalls" in last
        ? (last.toolCalls ?? [])
        : [];
    const config = ctx.agent.config as HitlConfig;
    const risky = calls.find((c: ToolCall) =>
      config.hitl?.tools.includes(c.name)
    );
    if (risky) {
      runState.status = "paused";
      runState.reason = "hitl";
      ctx.agent.emit(AgentEventType.RUN_PAUSED, {
        runId: runState.runId,
        reason: "hitl",
      });
    }
  },
  tags: ["hitl"],
});

// Re-export tool utilities
export {
  tool,
  getToolMeta,
  z,
  type ToolFn,
  type ToolResult,
  type ToolContext,
} from "./tools";

// Re-export sandbox middleware
export { sandbox, type SandboxConfig } from "./sandbox";
