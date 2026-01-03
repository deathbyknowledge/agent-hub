import { type AgentPlugin } from "agent-hub";

export const logger: AgentPlugin = {
  name: "logger",

  async onEvent(ctx, event) {
    console.log(`[${event.type.toUpperCase()} | ${ctx.agent.info.threadId.slice(0, 8)}]:\n${JSON.stringify(event, null, 2)}\n\n`);
  },

  tags: ["logs"],
};
