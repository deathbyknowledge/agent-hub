import { Router, type IRequest } from "itty-router";
import { getAgentByName } from "agents";
import type { AgentBlueprint, CfCtx, ThreadRequestContext } from "./types";
import type { R2Bucket } from "@cloudflare/workers-types";
import type { HubAgent } from "./agent";
import type { Agency } from "./agency";

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

type RequestContext = {
  env: HandlerEnv;
  ctx: CfCtx;
  opts: HandlerOptions;
};


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

/**
 * Timing-safe string comparison to prevent timing attacks.
 * Returns true if strings are equal, false otherwise.
 */
function secureCompare(a: string | null, b: string): boolean {
  if (a === null) return false;
  
  // Ensure both strings are the same length by hashing
  // This prevents length-based timing attacks
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  
  // If lengths differ, we still need to do constant-time work
  // XOR all bytes and accumulate differences
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let result = aBytes.length ^ bBytes.length; // Will be non-zero if lengths differ
  
  for (let i = 0; i < maxLen; i++) {
    const aByte = i < aBytes.length ? aBytes[i] : 0;
    const bByte = i < bBytes.length ? bBytes[i] : 0;
    result |= aByte ^ bByte;
  }
  
  return result === 0;
}

/**
 * Create a DO request URL that preserves the original host but remaps the pathname.
 * This is important for OAuth callbacks where the DO needs to know the public host.
 */
function createDoUrl(req: Request, pathname: string): URL {
  const url = new URL(req.url);
  url.pathname = pathname;
  return url;
}

function withCors(response: Response): Response {
  // Don't wrap WebSocket upgrade responses - they have a webSocket property
  // that gets lost when creating a new Response
  if ((response as any).webSocket) {
    return response;
  }
  
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

const getPlugins = (req: IRequest, { opts }: RequestContext) => {
  return Response.json({
    plugins: opts.plugins || [],
    tools: opts.tools || [],
  });
};


const listAgencies = async (req: IRequest, { env }: RequestContext) => {
  const agencies = [];
  const list = await env.FS.list({ delimiter: "/" });
  for (const prefix of list.delimitedPrefixes) {
    const agencyName = prefix.replace(/\/$/, "");
    const metaObj = await env.FS.get(`${agencyName}/.agency.json`);
    if (metaObj) {
      try {
        const meta = await metaObj.json();
        agencies.push(meta);
      } catch {
        // Corrupted or empty .agency.json - use defaults
        agencies.push({ id: agencyName, name: agencyName });
      }
    } else {
      agencies.push({ id: agencyName, name: agencyName });
    }
  }
  return Response.json({ agencies });
};

const createAgency = async (req: IRequest, { env }: RequestContext) => {
  const body = await req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = body.name?.trim();

  if (!name) {
    return new Response("Agency name is required", { status: 400 });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    return new Response(
      "Agency name must be alphanumeric with dashes/underscores only",
      { status: 400 }
    );
  }

  const existing = await env.FS.head(`${name}/.agency.json`);
  if (existing) {
    return new Response(`Agency '${name}' already exists`, { status: 409 });
  }

  const meta = {
    id: name,
    name: name,
    createdAt: new Date().toISOString(),
  };
  await env.FS.put(`${name}/.agency.json`, JSON.stringify(meta));

  return Response.json(meta, { status: 201 });
};


async function getAgencyStub(agencyId: string, ctx: CfCtx): Promise<DurableObjectStub<Agency>> {
  // Decode in case the agency ID contains slashes (e.g., "owner/repo")
  const decodedId = decodeURIComponent(agencyId);
  return getAgentByName(ctx.exports.Agency, decodedId);
}

/** Check if an agency exists (has been explicitly created via POST /agencies) */
async function agencyExists(agencyId: string, env: HandlerEnv): Promise<boolean> {
  if (!env.FS) return true; // No R2 bucket = skip check
  const metaObj = await env.FS.head(`${agencyId}/.agency.json`);
  return metaObj !== null;
}

/** 
 * Require agency to exist before proceeding. Returns 404 Response if not found.
 * Use in route handlers: const error = await requireAgency(...); if (error) return error;
 */
async function requireAgency(agencyId: string, env: HandlerEnv): Promise<Response | null> {
  const decodedId = decodeURIComponent(agencyId);
  const exists = await agencyExists(decodedId, env);
  if (!exists) {
    return new Response(
      JSON.stringify({ 
        error: "Agency not found",
        message: `Agency '${decodedId}' does not exist. Create it first with POST /agencies`,
        agencyId: decodedId,
      }),
      { status: 404, headers: { "content-type": "application/json" } }
    );
  }
  return null;
}

const deleteAgency = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/destroy"), { method: "DELETE" }));
};

const listBlueprints = async (req: IRequest, { ctx, opts }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  const res = await agencyStub.fetch(new Request(createDoUrl(req, "/blueprints")));
  if (!res.ok) return res;

  const dynamic = await res.json<{ blueprints: AgentBlueprint[] }>();
  const combined = new Map<string, AgentBlueprint>();

  (opts.agentDefinitions || []).forEach((b) => combined.set(b.name, b));
  dynamic.blueprints.forEach((b) => combined.set(b.name, b));

  return Response.json({ blueprints: Array.from(combined.values()) });
};

const createBlueprint = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/blueprints"), req));
};

const deleteBlueprint = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/blueprints/${req.params.blueprintName}`), { method: "DELETE" })
  );
};

const listAgents = async (req: IRequest, { ctx, env }: RequestContext) => {
  const notFound = await requireAgency(req.params.agencyId, env);
  if (notFound) return notFound;
  
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/agents")));
};

const createAgent = async (req: IRequest, { ctx, env }: RequestContext) => {
  const notFound = await requireAgency(req.params.agencyId, env);
  if (notFound) return notFound;
  
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  const body = await req.json<Record<string, unknown>>();
  body.requestContext = buildRequestContext(req);

  return agencyStub.fetch(
    new Request(createDoUrl(req, "/agents"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
};

const deleteAgent = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/agents/${req.params.agentId}`), { method: "DELETE" })
  );
};

const getAgentTree = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, `/agents/${req.params.agentId}/tree`)));
};

const getAgentForest = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/agents/tree")));
};

const listSchedules = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/schedules")));
};

const createSchedule = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, "/schedules"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: req.body,
    })
  );
};

const getSchedule = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, `/schedules/${req.params.scheduleId}`)));
};

const updateSchedule = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/schedules/${req.params.scheduleId}`), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: req.body,
    })
  );
};

const deleteSchedule = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/schedules/${req.params.scheduleId}`), { method: "DELETE" })
  );
};

const pauseSchedule = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/schedules/${req.params.scheduleId}/pause`), { method: "POST" })
  );
};

const resumeSchedule = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/schedules/${req.params.scheduleId}/resume`), { method: "POST" })
  );
};

const triggerSchedule = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/schedules/${req.params.scheduleId}/trigger`), { method: "POST" })
  );
};

const getScheduleRuns = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, `/schedules/${req.params.scheduleId}/runs`)));
};

// --- Vars ---

const getVars = async (req: IRequest, { ctx, env }: RequestContext) => {
  const notFound = await requireAgency(req.params.agencyId, env);
  if (notFound) return notFound;
  
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/vars")));
};

const setVars = async (req: IRequest, { ctx, env }: RequestContext) => {
  const notFound = await requireAgency(req.params.agencyId, env);
  if (notFound) return notFound;
  
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, "/vars"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: req.body,
    })
  );
};

const getVar = async (req: IRequest, { ctx, env }: RequestContext) => {
  const notFound = await requireAgency(req.params.agencyId, env);
  if (notFound) return notFound;
  
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, `/vars/${req.params.varKey}`)));
};

const setVar = async (req: IRequest, { ctx, env }: RequestContext) => {
  const notFound = await requireAgency(req.params.agencyId, env);
  if (notFound) return notFound;
  
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/vars/${req.params.varKey}`), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: req.body,
    })
  );
};

const deleteVar = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/vars/${req.params.varKey}`), { method: "DELETE" })
  );
};

// --- MCP Servers ---

const listMcpServers = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/mcp")));
};

const addMcpServer = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, "/mcp"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: req.body,
    })
  );
};

const removeMcpServer = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/mcp/${req.params.serverId}`), { method: "DELETE" })
  );
};

const retryMcpServer = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/mcp/${req.params.serverId}/retry`), { method: "POST" })
  );
};

const listMcpTools = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/mcp/tools")));
};

const callMcpTool = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(
    new Request(createDoUrl(req, "/mcp/call"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: req.body,
    })
  );
};

const handleFilesystem = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  const fsPath = req.params.path || "";
  return agencyStub.fetch(
    new Request(createDoUrl(req, `/fs/${fsPath}`), {
      method: req.method,
      headers: req.headers,
      body: req.body,
    })
  );
};

const getMetrics = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(new Request(createDoUrl(req, "/metrics")));
};

const handleAgencyWebSocket = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(req);
};

/**
 * Handle MCP OAuth callbacks. Forwards to Agency DO where the SDK handles the OAuth flow.
 */
const handleMcpOAuthCallback = async (req: IRequest, { ctx }: RequestContext) => {
  const agencyStub = await getAgencyStub(req.params.agencyId, ctx);
  return agencyStub.fetch(req);
};

const handleAgentRequest = async (req: IRequest, { ctx }: RequestContext) => {
  const hubAgentStub = await getAgentByName(ctx.exports.HubAgent, req.params.agentId);
  const agentPath = req.params.path || "";

  // WebSocket upgrade
  if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    return hubAgentStub.fetch(req);
  }

  const doUrl = new URL(req.url);
  doUrl.pathname = "/" + agentPath;

  let doReq: Request;

  // Special handling for invoke
  if (agentPath === "invoke" && req.method === "POST") {
    const body = await req.json<Record<string, unknown>>();
    body.threadId = req.params.agentId;
    doReq = new Request(doUrl, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(body),
    });
  } else {
    doReq = new Request(doUrl, req);
  }

  return hubAgentStub.fetch(doReq);
};

export const createHandler = (opts: HandlerOptions = {}) => {
  const router = Router<IRequest, [RequestContext]>();

  // Plugins
  router.get("/plugins", getPlugins);

  // Agencies
  router.get("/agencies", listAgencies);
  router.post("/agencies", createAgency);

  // Agency - destroy
  router.delete("/agency/:agencyId", deleteAgency);
  router.delete("/agency/:agencyId/destroy", deleteAgency);

  // Blueprints
  router.get("/agency/:agencyId/blueprints", listBlueprints);
  router.post("/agency/:agencyId/blueprints", createBlueprint);
  router.delete("/agency/:agencyId/blueprints/:blueprintName", deleteBlueprint);

  // Agents
  router.get("/agency/:agencyId/agents", listAgents);
  router.get("/agency/:agencyId/agents/tree", getAgentForest);
  router.post("/agency/:agencyId/agents", createAgent);
  router.get("/agency/:agencyId/agents/:agentId/tree", getAgentTree);
  router.delete("/agency/:agencyId/agents/:agentId", deleteAgent);

  // Schedules
  router.get("/agency/:agencyId/schedules", listSchedules);
  router.post("/agency/:agencyId/schedules", createSchedule);
  router.get("/agency/:agencyId/schedules/:scheduleId", getSchedule);
  router.patch("/agency/:agencyId/schedules/:scheduleId", updateSchedule);
  router.delete("/agency/:agencyId/schedules/:scheduleId", deleteSchedule);
  router.post("/agency/:agencyId/schedules/:scheduleId/pause", pauseSchedule);
  router.post("/agency/:agencyId/schedules/:scheduleId/resume", resumeSchedule);
  router.post("/agency/:agencyId/schedules/:scheduleId/trigger", triggerSchedule);
  router.get("/agency/:agencyId/schedules/:scheduleId/runs", getScheduleRuns);

  // Vars
  router.get("/agency/:agencyId/vars", getVars);
  router.put("/agency/:agencyId/vars", setVars);
  router.get("/agency/:agencyId/vars/:varKey", getVar);
  router.put("/agency/:agencyId/vars/:varKey", setVar);
  router.delete("/agency/:agencyId/vars/:varKey", deleteVar);

  // MCP Servers
  router.get("/agency/:agencyId/mcp", listMcpServers);
  router.post("/agency/:agencyId/mcp", addMcpServer);
  router.get("/agency/:agencyId/mcp/tools", listMcpTools);
  router.post("/agency/:agencyId/mcp/call", callMcpTool);
  router.delete("/agency/:agencyId/mcp/:serverId", removeMcpServer);
  router.post("/agency/:agencyId/mcp/:serverId/retry", retryMcpServer);

  // Filesystem (greedy param for path)
  router.all("/agency/:agencyId/fs/:path+", handleFilesystem);
  router.all("/agency/:agencyId/fs", handleFilesystem);

  // Metrics
  router.get("/agency/:agencyId/metrics", getMetrics);

  // Agency WebSocket (for UI event subscriptions)
  router.get("/agency/:agencyId/ws", handleAgencyWebSocket);

  // Agent (greedy param for agent routes)
  router.all("/agency/:agencyId/agent/:agentId/:path+", handleAgentRequest);
  router.all("/agency/:agencyId/agent/:agentId", handleAgentRequest);

  // MCP OAuth callbacks
  router.get("/oauth/agency/:agencyId/callback", handleMcpOAuthCallback);

  // 404
  router.all("*", () => new Response("Not found", { status: 404 }));

  return {
    async fetch(req: Request, env: HandlerEnv, ctx: CfCtx) {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // Auth check (skip for OAuth callbacks which come from browser redirects)
      // OAuth callback pattern: /oauth/agency/{agencyId}/callback with state param
      const isOAuthCallback = /^\/oauth\/agency\/[^/]+\/callback$/.test(url.pathname) && url.searchParams.has("state");
      const providedSecret = req.headers.get("X-SECRET") || url.searchParams.get("key");
      const secret = process.env.SECRET;
      if (secret && !secureCompare(providedSecret, secret) && !isOAuthCallback) {
        if (req.headers.get("Upgrade")?.toLowerCase() === "websocket") {
          return withCors(new Response("Unauthorized", { status: 401 }));
        }
        const path = url.pathname;
        if (
          path.startsWith("/api") ||
          path.startsWith("/agency") ||
          path.startsWith("/agencies") ||
          path.startsWith("/plugins")
        ) {
          return withCors(new Response("Unauthorized", { status: 401 }));
        }
        return new Response(
          "Forbidden: Please provide ?key=YOUR_SECRET or X-SECRET header",
          { status: 403 }
        );
      }

      // Route the request
      const response = await router.fetch(req, { env, ctx, opts });
      return withCors(response);
    },
  };
};
