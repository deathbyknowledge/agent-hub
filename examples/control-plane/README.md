# Control Plane

A universal web UI for managing any Agent Hub deployment. Deploy it once and connect to any hub.

## Quick Start

```sh
npm run dev
```

Open http://localhost:5173 and enter your hub's URL to connect.

## Deploy

```sh
npm run deploy
```

This deploys to Cloudflare Pages. You can then access your control plane at the provided URL and connect to any hub.

## How It Works

The Control Plane is a static React app that uses the `agents-hub/client` library to communicate with hubs. It stores the connected hub URL in localStorage, allowing you to:

1. Connect to any hub by entering its URL
2. Optionally provide a secret if the hub requires authentication
3. Manage agencies, agents, blueprints, schedules, and files
4. View real-time agent events via WebSocket

## Features

- **Universal**: Connect to any Agent Hub deployment
- **No backend**: Pure static app, deploy anywhere
- **Real-time**: WebSocket streaming of agent events
- **Full management**: Agents, blueprints, schedules, files, vars

## Notes

- **HTTPS required**: When deployed over HTTPS, you can only connect to HTTPS hubs (mixed content restriction)
- **CORS**: Hubs need `Access-Control-Allow-Origin: *` for cross-origin requests (enabled by default in dev mode)
