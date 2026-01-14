# agents-hub

A serverless agentic runtime for Cloudflare Workers. Build, deploy, and manage AI agents with persistent state, tool execution, and multi-tenant isolation.

Built on Cloudflare's [Agents SDK](https://github.com/cloudflare/agents) and [Durable Objects](https://developers.cloudflare.com/durable-objects/).

## Features

- **Serverless agents** - Each agent has its own compute and persistent storage
- **Multi-tenant** - Agencies provide isolation between different configurations
- **Tool execution** - Define tools with Zod schemas, automatic JSON Schema conversion
- **Plugin system** - Lifecycle hooks for customizing agent behavior
- **Capability-based** - Tag-based tool/plugin selection per agent blueprint
- **Scheduling** - Cron, interval, and one-time scheduled agent runs
- **R2 filesystem** - Per-agent file storage backed by Cloudflare R2
- **MCP support** - Connect to Model Context Protocol servers
- **HTTP + WebSocket API** - Full REST API with real-time event streaming

## Quick Start

Create a new project with a single command:

```bash
npx agents-hub init my-hub
cd my-hub
```

Configure your LLM provider in `.dev.vars`:

```
LLM_API_KEY=sk-your-key
LLM_API_BASE=https://api.openai.com/v1
LLM_RETRY_MAX=2
LLM_RETRY_BACKOFF_MS=500
LLM_RETRY_MAX_BACKOFF_MS=8000
LLM_RETRY_JITTER_RATIO=0.2
LLM_RETRY_STATUS_CODES=429,500,502,503,504,520
```

Start developing:

```bash
npm run dev
```

Open http://localhost:5173 to see your hub running.

## CLI Commands

| Command | Description |
|---------|-------------|
| `npx agents-hub init <name>` | Create a new project |
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run deploy` | Deploy to Cloudflare |

## Project Structure

```
my-hub/
├── hub/
│   ├── agents/      # Agent blueprints
│   ├── tools/       # Tool definitions
│   └── plugins/     # Custom plugins
├── .dev.vars        # Local LLM credentials
└── package.json
```

## Defining Agents

### Tools

```typescript
// hub/tools/greet.ts
import { tool } from "agents-hub";
import { z } from "zod";

export const greetTool = tool({
  name: "greet",
  description: "Greet a user by name",
  inputSchema: z.object({
    name: z.string().describe("The name to greet"),
  }),
  execute: async ({ name }) => {
    return `Hello, ${name}!`;
  },
});
```

### Blueprints

```typescript
// hub/agents/assistant.ts
import type { AgentBlueprint } from "agents-hub";

export default {
  name: "assistant",
  description: "A helpful assistant",
  prompt: "You are a helpful assistant. Be concise and friendly.",
  capabilities: ["@default", "greet"],
} satisfies AgentBlueprint;
```

## Advanced Configuration

For more control, create a `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import hub from "agents-hub/vite";

export default defineConfig({
  plugins: [
    hub({
      srcDir: "./hub",
      defaultModel: "gpt-4o",
    }),
  ],
});
```

The plugin handles Cloudflare configuration automatically. Pass `cloudflare: null` to disable it (codegen only).

## Exports

| Export | Description |
|--------|-------------|
| `agents-hub` | Core runtime (AgentHub, tool, types) |
| `agents-hub/client` | HTTP/WebSocket client library |
| `agents-hub/vite` | Vite plugin for auto-discovery |
| `agents-hub/plugins` | Built-in plugins (vars, hitl, logger, planning, mcp) |

## Client Usage

```typescript
import { AgentHubClient } from "agents-hub/client";

const client = new AgentHubClient({
  baseUrl: "https://your-hub.workers.dev",
  secret: "your-secret", // optional
});

// List agencies
const { agencies } = await client.listAgencies();

// Work with an agency
const agency = client.agency(agencies[0].id);
const { blueprints } = await agency.listBlueprints();

// Spawn and interact with an agent
const thread = await agency.spawnAgent({ agentType: "assistant" });
const agent = agency.agent(thread.id);

await agent.invoke({
  messages: [{ role: "user", content: "Hello!" }],
});

// Get agent state
const { state, run } = await agent.getState();
console.log(state.messages);

// Real-time events via WebSocket
agent.connect({
  onEvent: (event) => console.log(event),
});
```

## Plugins

Plugins extend agent behavior with lifecycle hooks:

```typescript
import type { AgentPlugin } from "agents-hub";

export const myPlugin: AgentPlugin = {
  name: "my-plugin",
  tags: ["default"],

  async onInit(ctx) {
    // Called once when agent is first registered
  },

  async beforeModel(ctx, plan) {
    // Modify the LLM request before it's sent
    plan.addSystemPrompt("Additional context...");
  },

  async onToolResult(ctx, call, result) {
    // React to tool execution results
  },

  async onRunComplete(ctx, { final }) {
    // Called when agent produces final output
  },
};
```

## Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `vars` | Resolves `$VAR_NAME` patterns in tool arguments |
| `hitl` | Human-in-the-loop approval for tool calls |
| `logger` | Event logging |
| `planning` | Todo list management via `write_todos` tool |

## Documentation

- [HTTP API Reference](../docs/reference/http-api.md) - Complete REST API documentation
- [Plugin Guide](../docs/guides/plugins.md) - Writing custom plugins
- [Deployment Guide](../docs/guides/deployment.md) - Production deployment

## Requirements

- Cloudflare Workers with Durable Objects
- R2 bucket (for filesystem features)
- Node.js 18+

## License

MIT
