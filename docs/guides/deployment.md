# Deployment Guide

This guide covers deploying AgentHub to Cloudflare Workers.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account with Workers Paid plan (for Durable Objects)

## Quick Deploy

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Deploy to Cloudflare
npx wrangler deploy
```

## Configuration

### Environment Variables

Set these via Wrangler secrets or in your Cloudflare dashboard:

```bash
# Required: LLM provider credentials
npx wrangler secret put LLM_API_KEY
npx wrangler secret put LLM_API_BASE  # e.g., https://api.openai.com/v1

# Optional: API authentication
npx wrangler secret put SECRET
```

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_API_KEY` | Yes | API key for your LLM provider |
| `LLM_API_BASE` | Yes | Base URL for the LLM API |
| `SECRET` | No | Secret for API authentication |

### Local Development

For local development, create `.dev.vars`:

```bash
LLM_API_KEY=sk-your-key
LLM_API_BASE=https://api.openai.com/v1
SECRET=dev-secret
```

Then run:

```bash
npm run dev
```

## Vite Plugin Configuration

The Vite plugin handles code generation and Cloudflare configuration:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import hub from "agents-hub/vite";

export default defineConfig({
  plugins: [
    hub({
      // Source directory for agents, tools, plugins
      srcDir: "./hub",
      
      // Output file for generated code
      outFile: "./_generated.ts",
      
      // Default model for agents
      defaultModel: "gpt-4o",
      
      // Enable container sandbox support
      sandbox: false,
      
      // Cloudflare configuration (merged with defaults)
      cloudflare: {
        name: "my-agent-hub",
        routes: [
          { pattern: "agents.example.com/*", zone_name: "example.com" }
        ],
      },
    }),
  ],
});
```

### Vite Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `srcDir` | `string` | `"./hub"` | Directory containing agents, tools, plugins |
| `outFile` | `string` | `"./_generated.ts"` | Generated entrypoint file |
| `defaultModel` | `string` | `"gpt-4o"` | Default LLM model |
| `sandbox` | `boolean` | `false` | Enable container sandbox support |
| `cloudflare` | `object \| null` | `{}` | Cloudflare config (null to disable) |

### Cloudflare Configuration

The plugin automatically configures:

- Durable Object bindings (`HubAgent`, `Agency`)
- R2 bucket binding (`FS`)
- SQLite migrations
- Asset handling for SPA

You can extend with custom configuration:

```typescript
cloudflare: {
  name: "my-hub",
  compatibility_date: "2025-01-01",
  routes: [...],
  
  // Add custom Durable Objects
  durable_objects: {
    bindings: [
      { class_name: "MyCustomDO", name: "MY_DO" }
    ]
  },
  
  // Add custom migrations
  migrations: [
    { new_sqlite_classes: ["MyCustomDO"], tag: "v3" }
  ],
}
```

Set `cloudflare: null` to disable the Cloudflare plugin (codegen only):

```typescript
hub({
  cloudflare: null,  // Only generate code, don't configure Cloudflare
})
```

## R2 Bucket Setup

AgentHub uses R2 for filesystem storage. Create a bucket:

```bash
npx wrangler r2 bucket create agents-hub-fs
```

The bucket is automatically bound as `FS` in the generated configuration.

### Custom Bucket Name

To use a different bucket name, override in cloudflare config:

```typescript
cloudflare: {
  r2_buckets: [
    { binding: "FS", bucket_name: "my-custom-bucket" }
  ]
}
```

## Project Structure

Recommended structure for deployment:

```
my-agent-hub/
├── hub/
│   ├── agents/           # Agent blueprints
│   │   └── assistant.ts
│   ├── tools/            # Tool definitions
│   │   └── greet.ts
│   └── plugins/          # Custom plugins
│       └── my-plugin.ts
├── src/                  # Optional: custom UI
├── .dev.vars             # Local secrets (git-ignored)
├── vite.config.ts
├── package.json
└── tsconfig.json
```

## Custom Domain

### Via Cloudflare Dashboard

1. Go to Workers & Pages > your worker
2. Settings > Triggers > Custom Domains
3. Add your domain

### Via Wrangler Config

```typescript
cloudflare: {
  routes: [
    { pattern: "agents.example.com/*", zone_name: "example.com" }
  ]
}
```

## Authentication

When `SECRET` is set, all API requests require authentication:

```bash
# Via header
curl -H "X-SECRET: your-secret" https://your-hub.workers.dev/agencies

# Via query parameter (useful for WebSocket)
curl https://your-hub.workers.dev/agencies?key=your-secret
```

The UI stores the secret in `localStorage` as `hub_secret`.

## Production Checklist

- [ ] Set `LLM_API_KEY` and `LLM_API_BASE` as secrets
- [ ] Set `SECRET` for API authentication
- [ ] Create R2 bucket
- [ ] Configure custom domain (optional)
- [ ] Set up monitoring/alerting (optional)

## Monitoring

### Logs

View real-time logs:

```bash
npx wrangler tail
```

### Durable Object Storage

Inspect Durable Object storage via Wrangler:

```bash
# List all Durable Objects
npx wrangler d1 execute --local

# Note: Direct DO inspection is limited; use the API for state inspection
```

### Agent State

Check agent state via API:

```bash
curl -H "X-SECRET: $SECRET" \
  https://your-hub.workers.dev/agency/my-agency/agent/agent-123/state
```

## Scaling Considerations

AgentHub is built on Cloudflare's global infrastructure:

- **Compute**: Durable Objects scale automatically
- **Storage**: R2 provides unlimited object storage
- **Concurrency**: Each agent runs in isolation

### Limits

| Resource | Limit |
|----------|-------|
| Durable Object CPU | 30s per request |
| Durable Object memory | 128MB |
| R2 object size | 5GB |
| WebSocket connections | 1,000 per DO |

For very long-running agents, consider:
- Breaking work into smaller tasks
- Using scheduled runs
- Implementing checkpointing

## Troubleshooting

### "Durable Object not found"

Ensure migrations have run:

```bash
npx wrangler deploy  # Triggers migrations
```

### "R2 bucket not found"

Create the bucket:

```bash
npx wrangler r2 bucket create agents-hub-fs
```

### "Unauthorized" errors

Check that:
1. `SECRET` env var matches your request header/param
2. You're hitting API routes (`/agencies`, `/agency/*`, etc.)

### Build errors

Ensure generated file exists:

```bash
# Regenerate
rm _generated.ts
npm run build
```

## Updating

To update AgentHub:

```bash
npm update agents-hub
npm run build
npx wrangler deploy
```

Check the changelog for breaking changes before upgrading.
