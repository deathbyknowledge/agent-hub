# Agents Hub

> **Alpha Software**: This project is in active development. Bugs and breaking changes are expected. Contributions are welcome!

Agent Hub offers a fully-managed distributed cloud execution environment for agents. It abstracts the infrastructure and runtime to free users from re-implementing the same primitives every time (plus handling Cloudflare's Developer platform quirks).  
This reduces the interface developers have to think about to just **prompts and tools** while allowing extensibility of the runtime with **plugins**.

It's entirely built on Cloudflare's Worker's platform (using the [Agents SDK](https://github.com/cloudflare/agents)), allowing 1-click deployments. 

## Architecture
![engine](https://github.com/user-attachments/assets/4f5809e5-ed8c-40b8-bc35-dc9b45ba5053)

_Take a look at [this](https://github.com/deathbyknowledge/agent-hub#full-picture) to see how the engine is integrated into the rest of the hub._

- **Runtime**: The serverless runtime where each Agent has its own [compute and storage](https://developers.cloudflare.com/agents/concepts/agent-class/#what-is-the-agent). Multi-tenant via **Agencies** - each Agency holds configuration for its Agents, which can communicate with each other. Exposes a full [HTTP API](docs/reference/http-api.md). See [lib/README.md](lib/README.md) for usage.
- **Client**: An HTTP/WS client library for any application. See [lib/README.md](lib/README.md) for usage.
- **Example UI**: A web UI for managing Agencies and Agents. It's a static app using the Runtime API. I use it as my personal hub but you're free to use it. Feel free to build your own or skip the UI entirely.
## Features

- **Serverless agents** - Each agent has isolated compute and persistent storage
- **Multi-tenant** - Agencies provide configuration isolation
- **Tool execution** - Define tools with Zod schemas, automatic validation
- **Plugin system** - Lifecycle hooks for customizing agent behavior ([guide](docs/guides/plugins.md))
- **Capability-based** - Tag-based tool/plugin selection per blueprint
- **Scheduling** - Cron, interval, and one-time scheduled agent runs
- **R2 filesystem** - Per-agent file storage backed by Cloudflare R2
- **MCP support** - Connect to Model Context Protocol servers
- **Human-in-the-loop** - Pause for approval on sensitive tool calls
- **Real-time events** - WebSocket streaming of agent events

## Getting Started

The fastest way to get started is with the CLI:

```sh
npx agents-hub init my-hub
cd my-hub
```

Configure your LLM provider in `.dev.vars`:

```
# You can always skip these but you'll have to set them manually for each Agency OR Blueprint.
LLM_API_KEY=sk-your-key
LLM_API_BASE=https://api.openai.com/v1
LLM_RETRY_MAX=2
LLM_RETRY_BACKOFF_MS=500
LLM_RETRY_MAX_BACKOFF_MS=8000
LLM_RETRY_JITTER_RATIO=0.2
LLM_RETRY_STATUS_CODES=429,500,502,503,504,520
```

Start the development server:

```sh
npm run dev
```

Open http://localhost:5173 to see your hub running.

### CLI Commands

| Command | Description |
|---------|-------------|
| `npx agents-hub init <name>` | Create a new project |
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run deploy` | Deploy to Cloudflare |

### Developing in this Repository

If you're contributing to agents-hub itself:

```sh
npm i
npm run dev
```

This spins up a Vite server with the runtime and UI. Changes to `hub/tools`, `hub/agents`, or `hub/plugins` are picked up automatically.

You can also set LLM credentials per-Agency in the UI settings page.


## Concepts

### Tools

Tools are function definitions your agents can use. The API is similar to the [AI SDK](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool), with an additional `context` parameter providing access to the agent instance:

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
  execute: async ({ name }, ctx) => {
    // ctx.agent gives access to filesystem, vars, sqlite, etc.
    return `Hello, ${name}!`;
  },
});
```

Tools are only available to agents that register them via `capabilities` in their blueprint.

### Blueprints

Blueprints are JSON definitions for agent templates - prompt, model, capabilities, and vars:

```typescript
// hub/agents/assistant.ts
import type { AgentBlueprint } from "agents-hub";

export default {
  name: "assistant",
  description: "A helpful assistant",
  prompt: "You are a helpful assistant. Be concise.",
  capabilities: ["@default", "greet"],  // @tag or tool/plugin name
  model: "gpt-4o",
  vars: { MAX_ITERATIONS: 10 },
} satisfies AgentBlueprint;
```

Since blueprints are serializable, you can create/edit them at runtime via the API without redeploying.

### Plugins

Plugins extend agent behavior with lifecycle hooks. They can modify prompts, intercept tool calls, contribute state, and expose actions:

```typescript
// hub/plugins/my-plugin.ts
import type { AgentPlugin } from "agents-hub";

export const myPlugin: AgentPlugin = {
  name: "my-plugin",
  tags: ["default"],

  async beforeModel(ctx, plan) {
    plan.addSystemPrompt("Additional context...");
  },

  async onToolResult(ctx, call, result) {
    console.log(`Tool ${call.name} returned:`, result);
  },
};
```

See the [Plugin Guide](docs/guides/plugins.md) for all available hooks and examples.

## Deployment

```sh
npm run build
npx wrangler deploy
```

Set secrets:
```sh
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_API_BASE
npx wrangler secret put SECRET  # optional: API authentication
```

See the [Deployment Guide](docs/guides/deployment.md) for full instructions.

## Documentation

- [HTTP API Reference](docs/reference/http-api.md) - Complete REST API documentation
- [Plugin Guide](docs/guides/plugins.md) - Writing custom plugins
- [Deployment Guide](docs/guides/deployment.md) - Production deployment
- [Library README](lib/README.md) - Client library and exports

## Full Picture
![birds-view](https://github.com/user-attachments/assets/6064beb0-ad2b-4a2f-b488-bf22061bf3d5)
