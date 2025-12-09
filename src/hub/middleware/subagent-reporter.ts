/**
 * Subagent Reporter Middleware (Child Side)
 *
 * This middleware is dynamically added to child agents and reports
 * completion back to the parent via the subagent_result action.
 */
import { defineMiddleware, type AgentEnv } from "@runtime";
import { getAgentByName } from "agents";

interface ParentInfo {
  threadId: string;
  token: string;
}

export const subagentReporter = defineMiddleware({
  name: "subagent_reporter",

  async onRunComplete(ctx, { final }) {
    // Get parent info from persisted meta
    const parent = ctx.agent.vars.parent as ParentInfo | undefined;

    if (!parent?.threadId || !parent?.token) {
      // Not a subagent, nothing to report
      return;
    }

    try {
      const parentAgent = await getAgentByName(
        (ctx.env as AgentEnv).HUB_AGENT,
        parent.threadId
      );

      // Send completion via action
      await parentAgent.fetch(
        new Request("http://do/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "subagent_result",
            token: parent.token,
            childThreadId: ctx.agent.info.threadId,
            report: final,
          }),
        })
      );
    } catch (e) {
      console.error("Failed to report to parent:", e);
    }
  },

  tags: ["subagent_reporter"],
});
