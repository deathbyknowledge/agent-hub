# HTTP API Reference

AgentHub exposes a REST API for managing agencies, agents, blueprints, schedules, and more.

## Authentication

All API endpoints require authentication when `SECRET` is set in your environment.

```bash
# Via header
curl -H "X-SECRET: your-secret" https://your-hub.workers.dev/agencies

# Via query parameter
curl https://your-hub.workers.dev/agencies?key=your-secret
```

## Base URL

All endpoints are relative to your deployment URL (e.g., `https://your-hub.workers.dev`).

---

## Agencies

Agencies provide multi-tenant isolation. Each agency has its own blueprints, agents, vars, and filesystem.

### List Agencies

```
GET /agencies
```

**Response:**
```json
{
  "agencies": [
    { "id": "my-agency", "name": "my-agency", "createdAt": "2024-01-01T00:00:00Z" }
  ]
}
```

### Create Agency

```
POST /agencies
Content-Type: application/json

{ "name": "my-agency" }
```

**Response:** `201 Created`
```json
{ "id": "my-agency", "name": "my-agency", "createdAt": "2024-01-01T00:00:00Z" }
```

**Errors:**
- `400` - Name is required or invalid (must be alphanumeric with dashes/underscores)
- `409` - Agency already exists

### Delete Agency

```
DELETE /agency/:agencyId
```

Deletes the agency and all its data (agents, blueprints, vars, filesystem).

---

## Blueprints

Blueprints define agent templates with prompts, capabilities, and configuration.

### List Blueprints

```
GET /agency/:agencyId/blueprints
```

Returns both static (code-defined) and dynamic (runtime-created) blueprints.

**Response:**
```json
{
  "blueprints": [
    {
      "name": "assistant",
      "description": "A helpful assistant",
      "prompt": "You are a helpful assistant.",
      "capabilities": ["@default"],
      "model": "gpt-4o"
    }
  ]
}
```

### Create Blueprint

```
POST /agency/:agencyId/blueprints
Content-Type: application/json

{
  "name": "my-agent",
  "description": "Custom agent",
  "prompt": "You are a custom agent.",
  "capabilities": ["@default", "my-tool"],
  "model": "gpt-4o",
  "vars": { "MAX_ITERATIONS": 20 }
}
```

### Delete Blueprint

```
DELETE /agency/:agencyId/blueprints/:blueprintName
```

Only deletes dynamic blueprints (code-defined blueprints cannot be deleted via API).

---

## Agents

Agents are running instances of blueprints with their own conversation state.

### List Agents

```
GET /agency/:agencyId/agents
```

**Response:**
```json
{
  "agents": [
    {
      "id": "abc123",
      "agentType": "assistant",
      "status": "completed",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Agent Tree

Returns the hierarchical tree of agents (parent-child relationships for subagents).

```
GET /agency/:agencyId/agents/tree
```

### Create Agent

```
POST /agency/:agencyId/agents
Content-Type: application/json

{
  "agentType": "assistant",
  "vars": { "CUSTOM_VAR": "value" }
}
```

**Response:** `201 Created`
```json
{
  "id": "abc123",
  "agentType": "assistant",
  "agencyId": "my-agency",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Delete Agent

```
DELETE /agency/:agencyId/agents/:agentId
```

### Get Single Agent Tree

```
GET /agency/:agencyId/agents/:agentId/tree
```

---

## Agent Operations

These endpoints interact with a specific agent instance.

### Get Agent State

```
GET /agency/:agencyId/agent/:agentId/state
```

**Response:**
```json
{
  "state": {
    "messages": [...],
    "tools": [...],
    "thread": { "id": "...", "agentType": "...", ... },
    "todos": [...]
  },
  "run": {
    "status": "completed",
    "step": 5
  }
}
```

### Invoke Agent

Send messages to an agent and trigger a run.

```
POST /agency/:agencyId/agent/:agentId/invoke
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

**Request body:**
| Field | Type | Description |
|-------|------|-------------|
| `messages` | `ChatMessage[]` | Messages to add to the conversation |
| `files` | `Record<string, string>` | Files to upload (path -> content) |
| `idempotencyKey` | `string` | Prevent duplicate processing |
| `vars` | `Record<string, unknown>` | Override vars for this invocation |

### Trigger Plugin Action

```
POST /agency/:agencyId/agent/:agentId/action
Content-Type: application/json

{
  "plugin": "hitl",
  "action": "approve",
  "payload": { "approved": true }
}
```

### Get Agent Events (SSE)

```
GET /agency/:agencyId/agent/:agentId/events
Accept: text/event-stream
```

Returns a Server-Sent Events stream of agent events.

### WebSocket Connection

```
GET /agency/:agencyId/agent/:agentId
Upgrade: websocket
```

Establishes a WebSocket connection for real-time bidirectional communication.

---

## Schedules

Schedules allow agents to run automatically on a timer.

### List Schedules

```
GET /agency/:agencyId/schedules
```

**Response:**
```json
{
  "schedules": [
    {
      "id": "sch_123",
      "name": "daily-report",
      "agentType": "reporter",
      "type": "cron",
      "cron": "0 9 * * *",
      "enabled": true
    }
  ]
}
```

### Create Schedule

```
POST /agency/:agencyId/schedules
Content-Type: application/json

{
  "name": "daily-report",
  "agentType": "reporter",
  "type": "cron",
  "cron": "0 9 * * *",
  "input": {
    "messages": [{ "role": "user", "content": "Generate daily report" }]
  }
}
```

**Schedule types:**
| Type | Fields | Description |
|------|--------|-------------|
| `cron` | `cron` | Standard cron expression |
| `interval` | `intervalMs` | Milliseconds between runs |
| `once` | `runAt` | ISO timestamp for one-time execution |

### Get Schedule

```
GET /agency/:agencyId/schedules/:scheduleId
```

### Update Schedule

```
PATCH /agency/:agencyId/schedules/:scheduleId
Content-Type: application/json

{ "cron": "0 10 * * *" }
```

### Delete Schedule

```
DELETE /agency/:agencyId/schedules/:scheduleId
```

### Pause Schedule

```
POST /agency/:agencyId/schedules/:scheduleId/pause
```

### Resume Schedule

```
POST /agency/:agencyId/schedules/:scheduleId/resume
```

### Trigger Schedule Manually

```
POST /agency/:agencyId/schedules/:scheduleId/trigger
```

### Get Schedule Runs

```
GET /agency/:agencyId/schedules/:scheduleId/runs
```

---

## Variables

Agency-level variables inherited by all agents.

### Get All Vars

```
GET /agency/:agencyId/vars
```

**Response:**
```json
{
  "vars": {
    "LLM_API_KEY": "sk-...",
    "MAX_ITERATIONS": 10
  }
}
```

### Set All Vars

```
PUT /agency/:agencyId/vars
Content-Type: application/json

{
  "LLM_API_KEY": "sk-...",
  "CUSTOM_VAR": "value"
}
```

### Get Single Var

```
GET /agency/:agencyId/vars/:varKey
```

### Set Single Var

```
PUT /agency/:agencyId/vars/:varKey
Content-Type: application/json

"value"
```

### Delete Var

```
DELETE /agency/:agencyId/vars/:varKey
```

---

## MCP Servers

Connect to Model Context Protocol servers for additional tools.

### List MCP Servers

```
GET /agency/:agencyId/mcp
```

**Response:**
```json
{
  "servers": [
    {
      "id": "mcp_123",
      "name": "my-mcp",
      "url": "https://mcp.example.com",
      "status": "connected"
    }
  ]
}
```

### Add MCP Server

```
POST /agency/:agencyId/mcp
Content-Type: application/json

{
  "name": "my-mcp",
  "url": "https://mcp.example.com",
  "apiKey": "optional-key"
}
```

### Remove MCP Server

```
DELETE /agency/:agencyId/mcp/:serverId
```

### Retry MCP Connection

```
POST /agency/:agencyId/mcp/:serverId/retry
```

### List MCP Tools

```
GET /agency/:agencyId/mcp/tools
```

### Call MCP Tool

```
POST /agency/:agencyId/mcp/call
Content-Type: application/json

{
  "serverId": "mcp_123",
  "tool": "tool-name",
  "args": { ... }
}
```

---

## Filesystem

R2-backed filesystem for persistent file storage.

### Read File/Directory

```
GET /agency/:agencyId/fs/:path
```

For directories, returns a listing. For files, returns the content.

### Write File

```
PUT /agency/:agencyId/fs/:path
Content-Type: application/octet-stream

<file content>
```

### Delete File

```
DELETE /agency/:agencyId/fs/:path
```

### Path Resolution

| Prefix | Resolves To |
|--------|-------------|
| `~/` | Agent's private directory |
| `/shared/` | Agency shared directory |
| `/agents/:id/` | Specific agent's directory |
| (other) | Agency root |

---

## Plugins & Tools

### List Registered Plugins and Tools

```
GET /plugins
```

**Response:**
```json
{
  "plugins": [
    { "name": "vars", "tags": ["default"] },
    { "name": "hitl", "tags": ["hitl"], "varHints": [...] }
  ],
  "tools": [
    { "name": "greet", "description": "Greet a user", "tags": ["default"] }
  ]
}
```

---

## Error Responses

All errors return JSON with an error message:

```json
{ "error": "Description of the error" }
```

Common status codes:
| Code | Description |
|------|-------------|
| `400` | Bad request (invalid input) |
| `401` | Unauthorized (missing/invalid secret) |
| `404` | Resource not found |
| `409` | Conflict (resource already exists) |
| `500` | Internal server error |
