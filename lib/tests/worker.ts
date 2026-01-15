import { AgentHub, type AgentBlueprint, plugins } from "../runtime";
import { tool, z } from "../runtime/tools";
import { TestProvider } from "../runtime/providers/test";
import { getAgentByName as _getAgentByName } from "agents";

/**
 * Type-safe wrapper for getAgentByName that works with our test env.
 * The agents SDK expects branded DurableObjectNamespace types, but vitest
 * provides unbranded ones. This helper casts appropriately.
 */
export async function getAgentByName(
  ns: DurableObjectNamespace,
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return _getAgentByName(ns as any, name);
}

/**
 * Shared TestProvider instance for all tests.
 * Tests can queue responses and assert on requests.
 * 
 * @example
 * ```ts
 * import { testProvider } from "./worker";
 * 
 * beforeEach(() => testProvider.reset());
 * 
 * it("should call the echo tool", async () => {
 *   testProvider.addResponse({
 *     toolCalls: [{ id: "1", name: "echo", args: { message: "hello" } }]
 *   });
 *   testProvider.addResponse("Done!");
 *   // ... run the agent
 *   expect(testProvider.toolCalls).toHaveLength(1);
 * });
 * ```
 */
export const testProvider = new TestProvider();

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
  capabilities: ["@test", "@default", "@hitl", "@context"],
  model: "gpt-4o-mini",
};

// Parent agent that can spawn subagents
const parentBlueprint: AgentBlueprint = {
  name: "parent-agent",
  description: "A parent agent that can spawn subagents",
  prompt: "You are a parent agent. Use the task tool to delegate work to child agents.",
  capabilities: ["@test", "@subagents"],
  model: "gpt-4o-mini",
};

// Child agent that reports back to parent
const childBlueprint: AgentBlueprint = {
  name: "child-agent",
  description: "A child agent that reports back to parent",
  prompt: "You are a child agent. Complete the task and report back.",
  capabilities: ["@test", "@subagent_reporter"],
  model: "gpt-4o-mini",
};

const hub = new AgentHub({ defaultModel: "gpt-4o-mini", provider: testProvider })
  .addTool(echoTool, ["@test"])
  .addTool(addTool, ["@test"])
  .use(plugins.vars)
  .use(plugins.planning)
  .use(plugins.hitl)
  .use(plugins.context)
  .use(plugins.subagents)
  .use(plugins.subagentReporter)
  .use(plugins.logger, ["@test"])
  .addAgent(testBlueprint)
  .addAgent(parentBlueprint)
  .addAgent(childBlueprint);

// Export with standard names so ctx.exports.Agency and ctx.exports.HubAgent work
export const { HubAgent, Agency, handler } = hub.export();

// Re-export TestProvider type for test files
export type { TestProvider } from "../runtime/providers/test";

// Types are available at runtime via @cloudflare/vitest-pool-workers
export interface Env {
  HUB_AGENT: DurableObjectNamespace;
  AGENCY: DurableObjectNamespace;
  FS: R2Bucket;
}

// Export the handler directly - it has a fetch method that vitest-pool-workers expects
export default handler;
