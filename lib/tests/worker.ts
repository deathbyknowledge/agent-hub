import { AgentHub, type AgentBlueprint, plugins } from "../runtime";
import { tool, z } from "../runtime/tools";
import { TestProvider } from "../runtime/providers/test";

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

const hub = new AgentHub({ defaultModel: "gpt-4o-mini", provider: testProvider })
  .addTool(echoTool, ["@test"])
  .addTool(addTool, ["@test"])
  .use(plugins.vars)
  .use(plugins.planning)
  .use(plugins.hitl)
  .use(plugins.context)
  .use(plugins.logger, ["@test"])
  .addAgent(testBlueprint);

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
