import { AgentHub, type AgentBlueprint, plugins } from "../runtime";
import { tool, z } from "../runtime/tools";
import type { HubAgent as HubAgentType } from "../runtime/agent";
import type { Agency as AgencyType } from "../runtime/agency";

const echoTool = tool({
  name: "echo",
  description: "Echo back the input message",
  inputSchema: z.object({
    message: z.string().describe("Message to echo"),
  }),
  execute: async ({ message }) => {
    return `Echo: ${message}`;
  },
});

const addTool = tool({
  name: "add",
  description: "Add two numbers",
  inputSchema: z.object({
    a: z.number().describe("First number"),
    b: z.number().describe("Second number"),
  }),
  tags: ["math"],  // intrinsic tag
  execute: async ({ a, b }) => {
    return { result: a + b };
  },
});

const testBlueprint: AgentBlueprint = {
  name: "test-agent",
  description: "A test agent for unit tests",
  prompt: "You are a test agent. Use the tools provided to help with testing.",
  capabilities: ["@test", "@default", "@hitl"],
  model: "gpt-4o-mini",
};

const hub = new AgentHub({ defaultModel: "gpt-4o-mini" })
  .addTool(echoTool, ["@test"])
  .addTool(addTool, ["@test"])
  .use(plugins.vars)
  .use(plugins.planning)
  .use(plugins.hitl)
  .use(plugins.logger, ["@test"])
  .addAgent(testBlueprint);

// Export with standard names so ctx.exports.Agency and ctx.exports.HubAgent work
export const { HubAgent, Agency, handler } = hub.export();

// Types are available at runtime via @cloudflare/vitest-pool-workers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Env {
  HUB_AGENT: any;
  AGENCY: any;
  FS: any;
}

// Export the handler directly - it has a fetch method that vitest-pool-workers expects
export default handler;
