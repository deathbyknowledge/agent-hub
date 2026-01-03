import { AgentHub, type AgentBlueprint } from "../runtime";
import { tool, z } from "../runtime/tools";
import type { HubAgent } from "../runtime/agent";
import type { Agency } from "../runtime/agency";

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
  execute: async ({ a, b }) => {
    return { result: a + b };
  },
});

const testBlueprint: AgentBlueprint = {
  name: "test-agent",
  description: "A test agent for unit tests",
  prompt: "You are a test agent. Use the tools provided to help with testing.",
  capabilities: ["@test"],
  model: "gpt-4o-mini",
};

const hub = new AgentHub({ defaultModel: "gpt-4o-mini" })
  .addTool(echoTool, ["@test"])
  .addTool(addTool, ["@test"])
  .addAgent(testBlueprint);

export const { HubAgent: TestHubAgent, Agency: TestAgency, handler } = hub.export();

export interface Env {
  HUB_AGENT: DurableObjectNamespace<HubAgent>;
  AGENCY: DurableObjectNamespace<Agency>;
}

export default {
  fetch: handler,
};
