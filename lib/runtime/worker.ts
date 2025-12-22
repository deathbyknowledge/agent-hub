import { getAgentByName } from "agents";
import type { AgentBlueprint, CfCtx, ThreadRequestContext } from "./types";
import type { R2Bucket } from "@cloudflare/workers-types";
import type { HubAgent } from "./agent";
import type { Agency } from "./agency";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

const CF_CONTEXT_KEYS = [
  "colo",
  "country",
  "city",
  "region",
  "timezone",
  "postalCode",
  "asOrganization",
] as const;

type CfRequest = Request & { cf?: Record<string, unknown> };

function buildRequestContext(req: Request): ThreadRequestContext {
  const headers = req.headers;
  const cf = (req as CfRequest).cf ?? undefined;
  const context: ThreadRequestContext = {
    userAgent: headers.get("user-agent") ?? undefined,
    ip: headers.get("cf-connecting-ip") ?? undefined,
    referrer: headers.get("referer") ?? undefined,
    origin: headers.get("origin") ?? undefined,
  };
  if (cf) {
    const filtered: Record<string, unknown> = {};
    for (const key of CF_CONTEXT_KEYS) {
      const value = (cf as Record<string, unknown>)[key];
      if (value !== undefined) filtered[key] = value;
    }
    if (Object.keys(filtered).length > 0) {
      context.cf = filtered;
    }
  }
  return context;
}

export type PluginInfo = {
  name: string;
  tags: string[];
  varHints?: Array<{ name: string; required?: boolean; description?: string }>;
};

export type ToolInfo = {
  name: string;
  description?: string;
  tags: string[];
  varHints?: Array<{ name: string; required?: boolean; description?: string }>;
};

export type HandlerOptions = {
  baseUrl?: string;
  agentDefinitions?: AgentBlueprint[];
  plugins?: PluginInfo[];
  tools?: ToolInfo[];
};

type HandlerEnv = {
  FS: R2Bucket;
};

export const createHandler = (opts: HandlerOptions = {}) => {
  return {
    async fetch(req: Request, env: HandlerEnv, ctx: CfCtx) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // Auth check - accept secret from header or query param
      const providedSecret =
        req.headers.get("X-SECRET") || url.searchParams.get("key");
      const secret = process.env.SECRET;
      if (secret && providedSecret !== secret) {
        // Check if this is a WebSocket upgrade - return 401 for those
        if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
          return withCors(new Response("Unauthorized", { status: 401 }));
        }
        // For API calls, return 401
        if (
          path.startsWith("/api") ||
          path.startsWith("/agency") ||
          path.startsWith("/agencies") ||
          path.startsWith("/plugins")
        ) {
          return withCors(new Response("Unauthorized", { status: 401 }));
        }
        // For UI/asset requests, return 403 with hint
        return new Response(
          "Forbidden: Please provide ?key=YOUR_SECRET or set hub_secret in localStorage",
          { status: 403 }
        );
      }

      // ======================================================
      // Root: Agency Management
      // ======================================================

      // GET /plugins -> List all plugins and tools with metadata
      if (req.method === "GET" && path === "/plugins") {
        return withCors(
          Response.json({
            plugins: opts.plugins || [],
            tools: opts.tools || [],
          })
        );
      }

      // GET /agencies -> List all agencies (from R2 bucket)
      if (req.method === "GET" && path === "/agencies") {
        const agencies = [];

        // List top-level "directories" in R2 - each is an agency
        const list = await env.FS.list({ delimiter: "/" });
        for (const prefix of list.delimitedPrefixes) {
          const agencyName = prefix.replace(/\/$/, ""); // Remove trailing slash
          // Try to read agency metadata
          const metaObj = await env.FS.get(`${agencyName}/.agency.json`);
          if (metaObj) {
            const meta = await metaObj.json();
            agencies.push(meta);
          } else {
            // Agency exists but no metadata - provide minimal info
            agencies.push({ id: agencyName, name: agencyName });
          }
        }

        return withCors(Response.json({ agencies }));
      }

      // POST /agencies -> Create a new Agency
      if (req.method === "POST" && path === "/agencies") {
        const body = await req
          .json<{ name?: string }>()
          .catch(() => ({}) as { name?: string });

        const name = body.name?.trim();
        if (!name) {
          return withCors(
            new Response("Agency name is required", { status: 400 })
          );
        }

        // Validate name is URL-safe
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
          return withCors(
            new Response(
              "Agency name must be alphanumeric with dashes/underscores only",
              { status: 400 }
            )
          );
        }

        // Check if agency already exists
        const existing = await env.FS.head(`${name}/.agency.json`);
        if (existing) {
          return withCors(
            new Response(`Agency '${name}' already exists`, { status: 409 })
          );
        }

        // Create agency metadata in R2
        const meta = {
          id: name,
          name: name,
          createdAt: new Date().toISOString(),
        };
        await env.FS.put(`${name}/.agency.json`, JSON.stringify(meta));

        return withCors(Response.json(meta, { status: 201 }));
      }

      // ======================================================
      // Hierarchical Routing: /agency/:agencyId/...
      // ======================================================

      const matchAgency = path.match(/^\/agency\/([^/]+)(.*)$/);
      if (matchAgency) {
        const agencyId = matchAgency[1];
        const subPath = matchAgency[2] || "/"; // e.g. /agents, /blueprints, /agent/:id

        let agencyStub: DurableObjectStub<Agency>;
        try {
          agencyStub = await getAgentByName(ctx.exports.Agency, agencyId);
        } catch (e) {
          return withCors(new Response("Invalid Agency ID", { status: 400 }));
        }

        // --------------------------------------
        // Agency-level operations
        // --------------------------------------

        if (req.method === "DELETE" && (subPath === "/" || subPath === "" || subPath === "/destroy")) {
          const res = await agencyStub.fetch(
            new Request("http://do/destroy", { method: "DELETE" })
          );
          return withCors(res);
        }

        // GET /agency/:id/blueprints -> merge defaults + DO overrides
        if (req.method === "GET" && subPath === "/blueprints") {
          const res = await agencyStub.fetch(
            new Request("http://do/blueprints", req)
          );
          if (!res.ok) return withCors(res);

          const dynamic = await res.json<{ blueprints: AgentBlueprint[] }>();
          const combined = new Map<string, AgentBlueprint>();

          // 1. Static defaults
          (opts.agentDefinitions || []).forEach((b) => {
            combined.set(b.name, b);
          });

          // 2. Overrides (Agency wins)
          dynamic.blueprints.forEach((b) => {
            combined.set(b.name, b);
          });

          return withCors(
            Response.json({ blueprints: Array.from(combined.values()) })
          );
        }

        // POST /agency/:id/blueprints -> pass through to Agency DO
        if (req.method === "POST" && subPath === "/blueprints") {
          const res = await agencyStub.fetch(
            new Request("http://do/blueprints", req)
          );
          return withCors(res);
        }

        // DELETE /agency/:id/blueprints/:name -> delete blueprint
        if (req.method === "DELETE" && subPath.startsWith("/blueprints/")) {
          const res = await agencyStub.fetch(
            new Request(`http://do${subPath}`, {
              method: "DELETE",
            })
          );
          return withCors(res);
        }

        // GET /agency/:id/agents
        if (req.method === "GET" && subPath === "/agents") {
          const res = await agencyStub.fetch(
            new Request("http://do/agents", req)
          );
          return withCors(res);
        }

        // POST /agency/:id/agents -> spawn agent
        if (req.method === "POST" && subPath === "/agents") {
          const body = await req.json<any>();
          body.requestContext = buildRequestContext(req);

          const res = await agencyStub.fetch(
            new Request("http://do/agents", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            })
          );
          return withCors(res);
        }

        const deleteAgentMatch = subPath.match(/^\/agents\/([^/]+)$/);
        if (deleteAgentMatch && req.method === "DELETE") {
          const res = await agencyStub.fetch(
            new Request(`http://do/agents/${deleteAgentMatch[1]}`, {
              method: "DELETE",
            })
          );
          return withCors(res);
        }

        // --------------------------------------
        // Schedule Management
        // /agency/:id/schedules/*
        // --------------------------------------

        // GET /agency/:id/schedules -> list schedules
        if (req.method === "GET" && subPath === "/schedules") {
          const res = await agencyStub.fetch(
            new Request("http://do/schedules", req)
          );
          return withCors(res);
        }

        // POST /agency/:id/schedules -> create schedule
        if (req.method === "POST" && subPath === "/schedules") {
          const res = await agencyStub.fetch(
            new Request("http://do/schedules", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: req.body,
            })
          );
          return withCors(res);
        }

        // Schedule-specific operations
        const scheduleMatch = subPath.match(/^\/schedules\/([^/]+)(\/.*)?$/);
        if (scheduleMatch) {
          const scheduleId = scheduleMatch[1];
          const scheduleAction = scheduleMatch[2] || "";

          // GET /agency/:id/schedules/:scheduleId
          if (req.method === "GET" && scheduleAction === "") {
            const res = await agencyStub.fetch(
              new Request(`http://do/schedules/${scheduleId}`, req)
            );
            return withCors(res);
          }

          // PATCH /agency/:id/schedules/:scheduleId
          if (req.method === "PATCH" && scheduleAction === "") {
            const res = await agencyStub.fetch(
              new Request(`http://do/schedules/${scheduleId}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: req.body,
              })
            );
            return withCors(res);
          }

          // DELETE /agency/:id/schedules/:scheduleId
          if (req.method === "DELETE" && scheduleAction === "") {
            const res = await agencyStub.fetch(
              new Request(`http://do/schedules/${scheduleId}`, {
                method: "DELETE",
              })
            );
            return withCors(res);
          }

          // POST /agency/:id/schedules/:scheduleId/pause
          if (req.method === "POST" && scheduleAction === "/pause") {
            const res = await agencyStub.fetch(
              new Request(`http://do/schedules/${scheduleId}/pause`, {
                method: "POST",
              })
            );
            return withCors(res);
          }

          // POST /agency/:id/schedules/:scheduleId/resume
          if (req.method === "POST" && scheduleAction === "/resume") {
            const res = await agencyStub.fetch(
              new Request(`http://do/schedules/${scheduleId}/resume`, {
                method: "POST",
              })
            );
            return withCors(res);
          }

          // POST /agency/:id/schedules/:scheduleId/trigger
          if (req.method === "POST" && scheduleAction === "/trigger") {
            const res = await agencyStub.fetch(
              new Request(`http://do/schedules/${scheduleId}/trigger`, {
                method: "POST",
              })
            );
            return withCors(res);
          }

          // GET /agency/:id/schedules/:scheduleId/runs
          if (req.method === "GET" && scheduleAction === "/runs") {
            const res = await agencyStub.fetch(
              new Request(`http://do/schedules/${scheduleId}/runs`, req)
            );
            return withCors(res);
          }
        }

        // --------------------------------------
        // Agency Vars
        // /agency/:id/vars/*
        // --------------------------------------

        // GET /agency/:id/vars
        if (req.method === "GET" && subPath === "/vars") {
          const res = await agencyStub.fetch(
            new Request("http://do/vars", req)
          );
          return withCors(res);
        }

        // PUT /agency/:id/vars
        if (req.method === "PUT" && subPath === "/vars") {
          const res = await agencyStub.fetch(
            new Request("http://do/vars", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: req.body,
            })
          );
          return withCors(res);
        }

        // Var-specific operations
        const varMatch = subPath.match(/^\/vars\/([^/]+)$/);
        if (varMatch) {
          const varKey = varMatch[1];

          // GET /agency/:id/vars/:key
          if (req.method === "GET") {
            const res = await agencyStub.fetch(
              new Request(`http://do/vars/${varKey}`, req)
            );
            return withCors(res);
          }

          // PUT /agency/:id/vars/:key
          if (req.method === "PUT") {
            const res = await agencyStub.fetch(
              new Request(`http://do/vars/${varKey}`, {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: req.body,
              })
            );
            return withCors(res);
          }

          // DELETE /agency/:id/vars/:key
          if (req.method === "DELETE") {
            const res = await agencyStub.fetch(
              new Request(`http://do/vars/${varKey}`, {
                method: "DELETE",
              })
            );
            return withCors(res);
          }
        }

        // --------------------------------------
        // Filesystem
        // /agency/:id/fs/...
        // --------------------------------------

        if (subPath.startsWith("/fs")) {
          const res = await agencyStub.fetch(
            new Request(`http://do${subPath}`, {
              method: req.method,
              headers: req.headers,
              body: req.body,
            })
          );
          return withCors(res);
        }

        // --------------------------------------
        // Agent-level operations
        // /agency/:id/agent/:agentId/*
        // --------------------------------------

        const matchAgent = subPath.match(/^\/agent\/([^/]+)(.*)$/);
        if (matchAgent) {
          const agentId = matchAgent[1];
          const agentTail = matchAgent[2] || ""; // e.g. /invoke, /state, /ws

          const hubAgentStub = await getAgentByName(
            ctx.exports.HubAgent,
            agentId
          );

          const doUrl = new URL(req.url);
          doUrl.pathname = agentTail; // strip /agency/:id/agent/:agentId

          // WebSocket upgrade - pass through directly (don't wrap response)
          const isWebSocketUpgrade =
            req.headers.get("Upgrade")?.toLowerCase() === "websocket";
          if (isWebSocketUpgrade) {
            return hubAgentStub.fetch(req);
          }

          let doReq: Request;

          // POST /invoke -> inject threadId
          if (agentTail === "/invoke" && req.method === "POST") {
            const body = await req.json<Record<string, unknown>>();
            body.threadId = agentId;

            doReq = new Request(doUrl, {
              method: req.method,
              headers: req.headers,
              body: JSON.stringify(body),
            });
          } else {
            doReq = new Request(doUrl, req);
          }

          const res = await hubAgentStub.fetch(doReq);
          return withCors(res);
        }
      }

      return withCors(new Response("Not found", { status: 404 }));
    },
  };
};
