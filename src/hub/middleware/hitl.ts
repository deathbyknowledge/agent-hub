/**
 * HITL (Human-in-the-Loop) Middleware
 *
 * This middleware pauses the agent when risky tools are called,
 * allowing human approval before execution.
 */
import { defineMiddleware, type ToolCall } from "@runtime";
import { AgentEventType } from "@runtime";

/** Custom event types for HITL middleware */
export const HitlEventType = {
  INTERRUPT: "hitl.interrupt",
  RESUME: "hitl.resume",
} as const;

export type HitlConfig = {
  hitl?: {
    tools: string[];
  };
};

export interface ApprovePayload {
  approved: boolean;
  modifiedToolCalls?: ToolCall[];
}

export const hitl = defineMiddleware<HitlConfig>({
  name: "hitl",

  actions: {
    /**
     * Approve or reject pending tool calls
     */
    async approve(ctx, payload: unknown) {
      const { approved, modifiedToolCalls } = payload as ApprovePayload;
      const runState = ctx.agent.runState;
      const pending = ctx.agent.info.pendingToolCalls ?? [];

      if (!pending.length) {
        throw new Error("no pending tool calls");
      }

      const decided = modifiedToolCalls ?? pending;
      ctx.agent.info.pendingToolCalls = decided;

      // Resume run
      runState.status = "running";
      runState.reason = undefined;

      ctx.agent.emit(HitlEventType.RESUME, {
        approved,
        modifiedToolCalls: decided,
      });
      ctx.agent.emit(AgentEventType.RUN_RESUMED, {});

      // Call onResume hooks
      for (const m of ctx.agent.middleware) {
        await m.onResume?.(ctx, "hitl", payload);
      }

      await ctx.agent.ensureScheduled();
      return { ok: true };
    },

    /**
     * Cancel the current run
     */
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
    const config = ctx.agent.config as HitlConfig;
    const risky = calls.find((c: ToolCall) =>
      config.hitl?.tools.includes(c.name)
    );

    if (risky) {
      runState.status = "paused";
      runState.reason = "hitl";
      ctx.agent.emit(AgentEventType.RUN_PAUSED, {
        reason: "hitl",
      });
    }
  },

  tags: ["hitl"],
});
