import { z } from "zod";
import { tool, type AgentPlugin } from "agent-hub";
import { getSandbox, Sandbox } from "@cloudflare/sandbox";

const SandboxBashSchema = z.object({
  command: z.string().describe("The bash command to execute in the sandbox"),
});

const SandboxWriteFileSchema = z.object({
  path: z
    .string()
    .describe("Absolute path to write the file in the sandbox container"),
  content: z.string().describe("The content to write to the file"),
});

type SandboxInstance = Sandbox;

function getSandboxInstance(
  ns: DurableObjectNamespace,
  id: string
): SandboxInstance {
  const sandbox = getSandbox(ns as any, id, {
    sleepAfter: 60 * 30,
  });
  return sandbox;
}

const SANDBOX_SYSTEM_PROMPT = `## Sandbox Container

You have access to an isolated Linux container (sandbox) for executing commands.

**IMPORTANT**: The sandbox filesystem is EPHEMERAL - files created here are temporary and will be lost when the sandbox is destroyed. For persistent storage, use the agent's filesystem tools (ls, read_file, write_file) which are backed by R2 storage.

### Sandbox Tools:
- \`sandbox_bash\`: Execute any bash command (git, npm, python, ls, cat, grep, etc.)
- \`sandbox_write_file\`: Write file contents (easier than heredocs for multi-line)

### Workflow Tips:
1. Clone repos: \`git clone <url>\`
2. Explore: \`ls -la\`, \`tree\`, \`find\`
3. Read files: \`cat\`, \`head\`, \`tail\`, \`sed -n '10,20p'\`
4. Search: \`grep -r 'pattern' .\`
5. Run tests/linters via bash
6. Review changes: \`git diff\``;

export const sandbox: AgentPlugin = {
  name: "sandbox",

  varHints: [
    {
      name: "SANDBOX_ENV",
      description: "Environment variables to inject into the sandbox container",
      required: false,
    },
  ],

  async beforeModel(ctx, plan) {
    const sandboxNs = (ctx.agent.exports as any).Sandbox;
    if (!sandboxNs) {
      console.warn(
        "SANDBOX binding not found. Sandbox tools disabled. Add SANDBOX to your wrangler.jsonc."
      );
      return;
    }

    plan.addSystemPrompt(SANDBOX_SYSTEM_PROMPT);

    // Create sandbox instance scoped to this agent thread
    const sandboxId = `agent-${ctx.agent.info.threadId}`;
    const sb = getSandboxInstance(sandboxNs, sandboxId);

    const sandboxEnv = ctx.agent.vars.SANDBOX_ENV as Record<string, string>;

    // Helper to exec with env vars injected
    const exec = (cmd: string, opts?: { timeout?: number }) => {
      return sb.exec(cmd, { ...opts, env: { ...sandboxEnv } });
    };

    const sandbox_bash = tool({
      name: "sandbox_bash",
      description:
        "Execute a bash command in an isolated Linux container. Supports git, npm, python, and common CLI tools. The sandbox filesystem is EPHEMERAL - use for running tests, git operations, and code analysis.",
      inputSchema: SandboxBashSchema,
      execute: async ({ command }) => {
        try {
          const result = await exec(command, { timeout: 60000 });

          let output = "";
          if (result.stdout) output += result.stdout;
          if (result.stderr) output += (output ? "\n" : "") + result.stderr;

          if (!output.trim()) {
            return result.success
              ? "Command executed successfully (no output)"
              : `Command failed with exit code ${result.exitCode}`;
          }

          return output;
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    });

    const sandbox_write_file = tool({
      name: "sandbox_write_file",
      description:
        "Write content to a file in the sandbox container. Creates directories if needed. Operates on the EPHEMERAL sandbox filesystem - files will be lost when sandbox ends. For persistent storage, use the agent's write_file tool.",
      inputSchema: SandboxWriteFileSchema,
      execute: async ({ path: filePath, content }) => {
        try {
          await sb.writeFile(filePath, content);
          return `File written to sandbox: ${filePath}`;
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    });

    ctx.registerTool(sandbox_bash);
    ctx.registerTool(sandbox_write_file);
  },

  tags: ["sandbox"],
};
