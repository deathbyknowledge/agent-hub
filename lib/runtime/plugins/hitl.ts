import type { AgentPlugin, ToolCall } from "../types";
import { AgentEventType } from "../events";

/** Custom event types for HITL plugin */
const HitlEventType = {
  INTERRUPT: "hitl.interrupt",
  RESUME: "hitl.resume",
} as const;

interface ApprovePayload {
  approved: boolean;
  modifiedToolCalls?: ToolCall[];
}

/**
 * Human-in-the-Loop plugin that pauses the agent when risky tools are called,
 * allowing human approval before execution.
 *
 * Configure which tools require approval via the `HITL_TOOLS` var (string[]).
 */
export const hitl: AgentPlugin = {
  name: "hitl",

  varHints: [
    {
      name: "HITL_TOOLS",
      description: "Array of tool names that require human approval",
    },
  ],

  actions: {
    async approve(ctx, payload: unknown) {
      const { approved, modifiedToolCalls } = payload as ApprovePayload;
      const runState = ctx.agent.runState;
      const pending = ctx.agent.info.pendingToolCalls ?? [];

      if (!pending.length) {
        throw new Error("no pending tool calls");
      }

      const decided = modifiedToolCalls ?? pending;
      ctx.agent.info.pendingToolCalls = decided;

      runState.status = "running";
      runState.reason = undefined;

      ctx.agent.emit(HitlEventType.RESUME, {
        approved,
        modifiedToolCalls: decided,
      });
      ctx.agent.emit(AgentEventType.RUN_RESUMED, {});

      await ctx.agent.ensureScheduled();
      return { ok: true };
    },

    async cancel(ctx) {
      const runState = ctx.agent.runState;
      if (runState && runState.status !== "completed") {
        runState.status = "canceled";
        runState.reason = "user";
        ctx.agent.emit(AgentEventType.RUN_CANCELED, {});
      }
      return { ok: true };
    },
  },

  async onModelResult(ctx, res) {
    const runState = ctx.agent.runState;
    const last = res.message;
    const calls =
      last?.role === "assistant" && "toolCalls" in last
        ? (last.toolCalls ?? [])
        : [];
    const watchTools = ctx.agent.vars.HITL_TOOLS as string[] | undefined;
    const risky = calls.find((c: ToolCall) => watchTools?.includes(c.name));

    if (risky) {
      runState.status = "paused";
      runState.reason = "hitl";
      ctx.agent.emit(AgentEventType.RUN_PAUSED, {
        reason: "hitl",
      });
    }
  },

  tags: ["hitl"],
};
