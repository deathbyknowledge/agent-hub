# Plugin System Guide

Plugins extend agent behavior with lifecycle hooks, tools, state, and actions. They're the primary mechanism for customizing how agents work.

## Overview

A plugin is an object implementing the `AgentPlugin` interface:

```typescript
import type { AgentPlugin } from "agents-hub";

export const myPlugin: AgentPlugin = {
  name: "my-plugin",
  tags: ["default"],
  
  // Lifecycle hooks
  async onInit(ctx) { /* ... */ },
  async beforeModel(ctx, plan) { /* ... */ },
  // ... more hooks
};
```

Plugins are matched to agents via the `capabilities` field in blueprints:

```typescript
// Blueprint
{
  name: "assistant",
  capabilities: ["@default", "my-plugin"],  // Includes plugins with "default" tag OR named "my-plugin"
}
```

## Lifecycle Hooks

Hooks are called at specific points during agent execution:

```
onInit ──► onTick ──► beforeModel ──► [LLM Call] ──► onModelResult
                          ▲                              │
                          │                              ▼
                          │                      ┌──────────────┐
                          │                      │  Tool Calls? │
                          │                      └──────────────┘
                          │                        │ Yes    │ No
                          │                        ▼        ▼
                          │               onToolStart   onRunComplete
                          │                    │
                          │                    ▼
                          │              [Tool Executes]
                          │                    │
                          │                    ▼
                          │            onToolResult/onToolError
                          │                    │
                          └────────────────────┘
```

### `onInit(ctx)`

Called once when an agent is first registered (created). Use this for one-time setup like creating database tables.

```typescript
async onInit(ctx) {
  ctx.agent.sqlite`
    CREATE TABLE IF NOT EXISTS my_data (
      id INTEGER PRIMARY KEY,
      value TEXT
    )
  `;
}
```

### `onTick(ctx)`

Called at the start of each agent loop iteration. Useful for periodic checks or state updates.

```typescript
async onTick(ctx) {
  const elapsed = Date.now() - ctx.agent.info.createdAt;
  if (elapsed > 60000) {
    // Agent has been running for over a minute
  }
}
```

### `beforeModel(ctx, plan)`

Called before the LLM is invoked. Use this to modify the request: add system prompts, register tools, change model settings.

```typescript
async beforeModel(ctx, plan) {
  // Add to system prompt
  plan.addSystemPrompt("Always respond in JSON format.");
  
  // Register a tool dynamically
  ctx.registerTool(myTool);
  
  // Change model settings
  plan.setTemperature(0.7);
  plan.setMaxTokens(2000);
}
```

**`ModelPlanBuilder` methods:**
| Method | Description |
|--------|-------------|
| `addSystemPrompt(...parts)` | Append to system prompt |
| `setModel(id)` | Override the model |
| `setTemperature(t)` | Set temperature (0-2) |
| `setMaxTokens(n)` | Set max output tokens |
| `setToolChoice(choice)` | Force tool selection |
| `setResponseFormat(fmt)` | Set response format |
| `setStop(strings)` | Set stop sequences |

### `onModelResult(ctx, res)`

Called after the LLM responds, before tools execute. Inspect or modify the response.

```typescript
async onModelResult(ctx, res) {
  const message = res.message;
  
  if (message.role === "assistant" && "toolCalls" in message) {
    // LLM wants to call tools
    console.log("Tool calls:", message.toolCalls);
  }
}
```

### `onToolStart(ctx, call)`

Called before each tool executes. Modify arguments or perform pre-execution logic.

```typescript
async onToolStart(ctx, call) {
  // Log tool usage
  console.log(`Calling ${call.name} with`, call.args);
  
  // Modify arguments
  if (call.name === "write_file") {
    call.args.path = sanitizePath(call.args.path);
  }
}
```

### `onToolResult(ctx, call, result)`

Called after a tool executes successfully.

```typescript
async onToolResult(ctx, call, result) {
  // Track tool usage
  await ctx.agent.kv.put(`tool_usage:${call.name}`, 
    String(Number(await ctx.agent.kv.get(`tool_usage:${call.name}`) || 0) + 1)
  );
}
```

### `onToolError(ctx, call, error)`

Called when a tool throws an error.

```typescript
async onToolError(ctx, call, error) {
  ctx.agent.emit("tool.error", {
    tool: call.name,
    error: error.message,
  });
}
```

### `onRunComplete(ctx, result)`

Called when the agent produces a final text response (no more tool calls).

```typescript
async onRunComplete(ctx, result) {
  // result.final contains the final text response
  console.log("Agent finished:", result.final);
  
  // Save to history, send notification, etc.
}
```

### `onEvent(ctx, event)`

Called for every event the agent emits. Useful for logging or real-time monitoring.

```typescript
onEvent(ctx, event) {
  if (event.type === "model.completed") {
    console.log("Model response received");
  }
}
```

## Plugin Context

All hooks receive a `PluginContext` with access to:

```typescript
type PluginContext = {
  agent: HubAgent;           // The agent instance
  env: AgentEnv;             // Environment bindings
  registerTool: (tool) => void;  // Dynamic tool registration
};
```

### Agent Instance (`ctx.agent`)

The `HubAgent` provides access to:

| Property | Type | Description |
|----------|------|-------------|
| `vars` | `Record<string, unknown>` | Merged vars (agency + blueprint + invocation) |
| `kv` | `KVNamespace` | Key-value storage |
| `sqlite` | `SqliteTaggedTemplate` | SQLite database |
| `fs` | `R2Filesystem` | R2-backed filesystem |
| `info` | `ThreadMetadata` | Thread metadata |
| `runState` | `RunState` | Current run status |
| `messages` | `ChatMessage[]` | Conversation history |

**Methods:**
| Method | Description |
|--------|-------------|
| `emit(type, data)` | Emit a custom event |
| `ensureScheduled()` | Schedule the next tick |

## State Contribution

Plugins can contribute state visible in the agent's `/state` endpoint:

```typescript
export const myPlugin: AgentPlugin = {
  name: "my-plugin",
  tags: ["default"],
  
  state(ctx) {
    const rows = ctx.agent.sqlite`SELECT * FROM my_data`;
    return {
      myData: rows,
      itemCount: rows.length,
    };
  },
};
```

The returned object is merged into the agent's state response.

## Actions

Plugins can expose HTTP-callable actions:

```typescript
export const myPlugin: AgentPlugin = {
  name: "my-plugin",
  tags: ["default"],
  
  actions: {
    async doSomething(ctx, payload) {
      const { value } = payload as { value: string };
      ctx.agent.sqlite`INSERT INTO my_data (value) VALUES (${value})`;
      return { ok: true };
    },
    
    async getData(ctx) {
      return ctx.agent.sqlite`SELECT * FROM my_data`;
    },
  },
};
```

Call via HTTP:

```bash
POST /agency/:agencyId/agent/:agentId/action
Content-Type: application/json

{
  "plugin": "my-plugin",
  "action": "doSomething",
  "payload": { "value": "hello" }
}
```

## Variable Hints

Declare variables your plugin expects:

```typescript
export const myPlugin: AgentPlugin = {
  name: "my-plugin",
  tags: ["default"],
  
  varHints: [
    { name: "MY_API_KEY", required: true, description: "API key for external service" },
    { name: "MY_OPTION", description: "Optional configuration" },
  ],
};
```

These hints are exposed via `GET /plugins` to help users configure their agencies.

## Registering Plugins

### Via Vite Plugin (Auto-discovery)

Place plugin files in `hub/plugins/`:

```
hub/
  plugins/
    my-plugin.ts      # Tagged with ["default"]
    security/
      audit.ts        # Tagged with ["security"]
```

Directory structure determines tags.

### Programmatically

```typescript
import { AgentHub } from "agents-hub";
import { myPlugin } from "./my-plugin";

const hub = new AgentHub({ defaultModel: "gpt-4o" })
  .use(myPlugin)                    // Uses plugin's intrinsic tags
  .use(myPlugin, ["custom-tag"]);   // Override tags
```

## Example: Rate Limiting Plugin

```typescript
import type { AgentPlugin } from "agents-hub";

export const rateLimit: AgentPlugin = {
  name: "rate-limit",
  tags: ["default"],
  
  varHints: [
    { name: "RATE_LIMIT_MAX", description: "Max requests per minute (default: 60)" },
  ],
  
  async onInit(ctx) {
    ctx.agent.sqlite`
      CREATE TABLE IF NOT EXISTS rate_limit (
        minute INTEGER PRIMARY KEY,
        count INTEGER DEFAULT 0
      )
    `;
  },
  
  async beforeModel(ctx) {
    const maxPerMinute = (ctx.agent.vars.RATE_LIMIT_MAX as number) || 60;
    const minute = Math.floor(Date.now() / 60000);
    
    ctx.agent.sqlite`
      INSERT INTO rate_limit (minute, count) VALUES (${minute}, 1)
      ON CONFLICT(minute) DO UPDATE SET count = count + 1
    `;
    
    const [row] = ctx.agent.sqlite`SELECT count FROM rate_limit WHERE minute = ${minute}`;
    
    if (row && row.count > maxPerMinute) {
      throw new Error(`Rate limit exceeded: ${maxPerMinute} requests/minute`);
    }
    
    // Clean old entries
    ctx.agent.sqlite`DELETE FROM rate_limit WHERE minute < ${minute - 5}`;
  },
  
  state(ctx) {
    const minute = Math.floor(Date.now() / 60000);
    const [row] = ctx.agent.sqlite`SELECT count FROM rate_limit WHERE minute = ${minute}`;
    return {
      rateLimit: {
        current: row?.count || 0,
        max: (ctx.agent.vars.RATE_LIMIT_MAX as number) || 60,
      },
    };
  },
};
```

## Best Practices

1. **Use descriptive names** - Plugin names should clearly indicate their purpose
2. **Declare varHints** - Help users understand what configuration is needed
3. **Contribute state** - Expose relevant data via `state()` for debugging
4. **Handle errors gracefully** - Use `onToolError` to recover or log failures
5. **Keep hooks fast** - Avoid blocking operations in `onEvent`
6. **Use SQLite for persistence** - Durable storage within the agent
7. **Emit custom events** - Use `ctx.agent.emit()` for observability
