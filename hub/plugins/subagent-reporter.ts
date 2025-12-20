/**
 * Subagent Reporter Plugin (Child Side)
 *
 * This plugin is dynamically added to child agents and reports
 * completion back to the parent via the subagent_result action.
 */
import { type AgentPlugin, type AgentEnv } from "@runtime";
import { getAgentByName } from "agents";

interface ParentInfo {
  threadId: string;
  token: string;
  /** Custom action type for reporting back (default: subagent_result) */
  action?: string;
}

export const subagentReporter: AgentPlugin = {
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
        ctx.agent.exports.HubAgent,
        parent.threadId
      );

      // Send completion via action (supports custom action types for orchestrator)
      const actionType = parent.action ?? "subagent_result";
      await parentAgent.fetch(
        new Request("http://do/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: actionType,
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
};
