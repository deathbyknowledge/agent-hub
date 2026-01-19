import { type Provider } from "../providers";
import type {
  AgentPlugin,
  Tool,
  ToolCall,
  InvokeBody,
  PluginContext,
  ThreadMetadata,
  AgentState,
  ThreadRequestContext,
  RunState,
  AgentBlueprint,
  AgentEnv,
  CfCtx,
  SystemInstruction,
} from "../types";
import { Agent, type AgentContext, getAgentByName } from "agents";
import { type AgentEvent, AgentEventType, type InferenceDetailsData } from "../events";
import { Store } from "./store";
import { PersistedObject } from "../persisted";
import { AgentFileSystem } from "../fs";
import { ModelPlanBuilder } from "../plan";
import { DEFAULT_MAX_ITERATIONS, MAX_TOOLS_PER_TICK } from "../config";
import { toOTelMessage, toOTelMessages, fromOTelMessages, userMessage } from "../messages";
import {
  projectEvents,
  projectFromSnapshot,
  createSnapshot,
  shouldSnapshot,
  type AgentProjection,
} from "./projections";

/** Event relayed from agent to agency */
export type AgencyRelayEvent = AgentEvent & {
  agentId: string;
  agentType: string;
};

export type Info = {
  threadId: string;
  agencyId: string;
  createdAt: string;
  request: ThreadRequestContext;
  agentType: string;
  pendingToolCalls?: ToolCall[];
  blueprint?: AgentBlueprint;
  /** Thread ID this agent was forked from */
  forkedFrom?: string;
  /** Event sequence number this agent was forked at */
  forkedAt?: number;
};
export abstract class HubAgent<
  Env extends AgentEnv = AgentEnv,
> extends Agent<Env> {
  protected _tools: Record<string, Tool<any>> = {};
  private _fs: AgentFileSystem | null = null;
  
  /** WebSocket connection to Agency for event relay during active runs */
  private _agencyWs: WebSocket | null = null;
  private _agencyWsConnecting = false;

  // State
  readonly info: Info;
  readonly runState: RunState;
  /** Open-typed persisted metadata, accessible to all plugins */
  readonly vars: Record<string, unknown>;
  store: Store;
  observability = undefined;

  constructor(ctx: AgentContext, env: Env) {
    super(ctx, env);
    const { kv, sql } = ctx.storage;
    this.store = new Store(sql);
    this.store.init();
    this.info = PersistedObject<Info>(kv, { prefix: "_info" });
    this.runState = PersistedObject<RunState>(kv, {
      prefix: "_runState",
      defaults: {
        status: "registered",
        step: 0,
      },
    });
    this.vars = PersistedObject<Record<string, unknown>>(kv, {
      prefix: "_vars",
      defaults: {
        MAX_ITERATIONS: DEFAULT_MAX_ITERATIONS,
      },
    });
  }

  abstract get blueprint(): AgentBlueprint;
  abstract get plugins(): AgentPlugin[];
  // biome-ignore lint/suspicious/noExplicitAny: tools have varying input types
  abstract get tools(): Record<string, Tool<any>>;
  abstract get provider(): Provider;
  abstract onRegister(meta: ThreadMetadata): Promise<void>;

  get kv() {
    return this.ctx.storage.kv;
  }
  get sqlite() {
    const sql = this.sql;
    return sql.bind(this);
  }

  get exports() {
    return (this.ctx as unknown as CfCtx).exports;
  }

  /**
   * Get messages from event projection (event-sourced).
   * This replaces the old store.getContext() approach.
   */
  get messages() {
    return this.getProjectedMessages();
  }

  /**
   * Get the current projection state (event-sourced).
   * This is the full projected state including messages, status, summaries, etc.
   */
  get projection(): AgentProjection {
    return this.computeProjection();
  }

  /**
   * Compute projection by replaying events.
   * Uses snapshots for optimization when available.
   */
  private computeProjection(): AgentProjection {
    const snapshot = this.store.getLatestSnapshot();
    
    if (snapshot) {
      const recentEvents = this.store.getEventsAfter(snapshot.lastEventSeq);
      return projectFromSnapshot(snapshot.state, snapshot.lastEventSeq, recentEvents);
    } else {
      const events = this.store.listEvents();
      return projectEvents(events);
    }
  }

  /**
   * Get messages by projecting events.
   * Uses snapshots for optimization when available.
   */
  private getProjectedMessages(): import("../types").ChatMessage[] {
    const projection = this.computeProjection();
    // Convert OTel messages to legacy format for backward compatibility
    return fromOTelMessages(projection.messages);
  }

  get model(): string {
    const model = this.blueprint.model ?? (this.vars.DEFAULT_MODEL as string);

    if (!model)
      throw new Error(
        "Agent blueprint.model and vars.DEFAULT_MODEL are both missing!"
      );

    return model;
  }

  /** R2-backed filesystem with per-agent home directory and shared space. */
  get fs(): AgentFileSystem {
    if (this._fs) return this._fs;

    const bucket = this.env.FS;
    if (!bucket)
      throw new Error(
        "R2 bucket not configured. Set FS binding in wrangler.jsonc."
      );

    const agencyId = this.info.agencyId;
    const agentId = this.info.threadId;
    if (!agencyId || !agentId)
      throw new Error("Agent identity not set. Call registerThread first.");

    this._fs = new AgentFileSystem(bucket, { agencyId, agentId });
    return this._fs;
  }

  get pluginContext(): PluginContext {
    return {
      agent: this,
      env: this.env,
      registerTool: <T>(tool: Tool<T>) => {
        this._tools[tool.meta.name] = tool;
      },
    };
  }

  get isPaused() {
    return this.runState.status === "paused";
  }

  async onRequest(req: Request) {
    const url = new URL(req.url);
    switch (url.pathname) {
      case "/invoke":
        return this.invoke(req);
      case "/action":
        return this.action(req);
      case "/state":
        return this.getState(req);
      case "/events":
        return this.getEvents(req);
      case "/register":
        if (req.method === "POST") return this.registerThread(req);
        return new Response("method not allowed", { status: 405 });
      case "/destroy":
        if (req.method === "DELETE") {
          await this.destroy();
          return new Response(null, { status: 204 });
        }
        return new Response("method not allowed", { status: 405 });
      // Event sourcing endpoints
      case "/projection":
        if (req.method !== "GET") {
          return new Response("method not allowed", { status: 405 });
        }
        return this.getProjection(req);
      case "/export":
        if (req.method !== "GET") {
          return new Response("method not allowed", { status: 405 });
        }
        return this.exportEvents(req);
      case "/fork":
        if (req.method !== "POST") {
          return new Response("method not allowed", { status: 405 });
        }
        return this.forkAgent(req);
      // Internal endpoint for receiving copied events during fork
      // Protected by X-Fork-Token header (set by source agent during fork)
      case "/internal/copy-events":
        if (req.method !== "POST") {
          return new Response("method not allowed", { status: 405 });
        }
        return this.copyEvents(req);
      default:
        return new Response("not found", { status: 404 });
    }
  }

  async scheduleStep() {
    const now = new Date();
    this.runState.nextAlarmAt = now.getTime();
    await this.schedule(now, "run");
  }

  async ensureScheduled() {
    if (this.runState.status !== "running") return;
    const schedules = this.getSchedules();
    if (!schedules.length) await this.scheduleStep();
  }

  async registerThread(req: Request) {
    try {
      const metadata = await req.json<ThreadMetadata>().catch(() => null);
      if (!metadata || !metadata.id) {
        return new Response("invalid metadata", { status: 400 });
      }

      if (!this.info.threadId) {
        this.info.threadId = metadata.id;
      }

      this.info.createdAt = metadata.createdAt;
      this.info.request = metadata.request;

      if (metadata.agentType) {
        this.info.agentType = metadata.agentType;
      }

      if (metadata.vars) {
        Object.assign(this.vars, metadata.vars);
      }

      await this.onRegister(metadata);

      return Response.json({ ok: true });
    } catch (error: unknown) {
      const err = error as Error;
      return new Response(err.message, { status: 500 });
    }
  }

  async invoke(req: Request) {
    try {
      const body = (await req.json().catch(() => ({}))) as InvokeBody;

      if (body.vars) {
        Object.assign(this.vars, body.vars);
      }

      // Emit user messages as event (event-sourced)
      if (body.messages?.length) {
        const otelMessages = toOTelMessages(body.messages);
        this.emit(AgentEventType.USER_MESSAGE, {
          "gen_ai.content.messages": otelMessages,
        });
      }

      if (body.files && typeof body.files === "object") {
        const fs = this.fs;
        await Promise.all(
          Object.entries(body.files).map(([filename, content]) =>
            fs.writeFile(`~/${filename}`, content)
          )
        );
      }

      const runState = this.runState;
      if (
        ["completed", "canceled", "error", "registered"].includes(
          runState.status
        )
      ) {
        runState.status = "running";
        // Connect to Agency WebSocket for event relay during the run
        await this.connectToAgency();
        this.emit(AgentEventType.AGENT_INVOKED, {});
        await this.ensureScheduled();
      }

      const { status } = runState;
      return Response.json({ status }, { status: 202 });
    } catch (error: unknown) {
      const err = error as Error;
      return Response.json(
        { error: err.message, stack: err.stack },
        { status: 500 }
      );
    }
  }

  async run() {
    try {
      if (this.runState.status !== "running") return;

      // MAX_ITERATIONS: undefined = use default (200), 0 = disabled, >0 = custom limit
      const maxIterations = this.vars.MAX_ITERATIONS as number | undefined;
      const iterationLimit = maxIterations === 0 ? Infinity : (maxIterations ?? DEFAULT_MAX_ITERATIONS);
      if (this.runState.step >= iterationLimit) {
        this.runState.status = "error";
        this.runState.reason = `Maximum iterations exceeded (${iterationLimit})`;
        this.emit(AgentEventType.AGENT_ERROR, {
          "error.type": "max_iterations_exceeded",
          "error.message": this.runState.reason,
        });
        return;
      }

      this.emit(AgentEventType.AGENT_STEP, {
        step: this.runState.step,
      });
      this.runState.step += 1;

      for (const p of this.plugins) await p.onTick?.(this.pluginContext);
      if (this.isPaused) return;

      const hasPendingTools = (this.info.pendingToolCalls ?? []).length > 0;

      if (!hasPendingTools) {
        const plan = new ModelPlanBuilder(this);
        for (const p of this.plugins)
          await p.beforeModel?.(this.pluginContext, plan);

        if (this.isPaused) return;

        const req = plan.build();
        const res = await this.provider.invoke(req, {});

        for (const p of this.plugins)
          await p.onModelResult?.(this.pluginContext, res);

        // Emit INFERENCE_DETAILS event (event-sourced - replaces store.add)
        // This captures the complete input/output for state replay
        this.emitInferenceDetails(req, res);

        let toolCalls: ToolCall[] = [];
        let reply = "";
        let reasoning: string | undefined;

        if ("toolCalls" in res.message) toolCalls = res.message.toolCalls;
        if ("content" in res.message) reply = res.message.content;
        if ("reasoning" in res.message) reasoning = res.message.reasoning;

        // Emit assistant message event so UI can update incrementally
        this.emit(AgentEventType.CONTENT_MESSAGE, {
          "gen_ai.content.text": reply || undefined,
          "gen_ai.content.reasoning": reasoning || undefined,
          "gen_ai.content.tool_calls": toolCalls.length > 0 ? toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.args,
          })) : undefined,
        });

        if (!toolCalls.length) {
          this.runState.status = "completed";

          // Call plugin hooks with error protection
          for (const plugin of this.plugins) {
            try {
              await plugin.onRunComplete?.(this.pluginContext, {
                final: reply,
              });
            } catch (pluginError) {
              console.error(
                `Plugin ${plugin.name} onRunComplete error:`,
                pluginError
              );
            }
          }

          this.emit(AgentEventType.AGENT_COMPLETED, { result: reply });
          // Create snapshot for future replay optimization
          await this.createProjectionSnapshot();
          // Disconnect from Agency WebSocket - run is done
          this.disconnectFromAgency();
          return;
        }

        this.info.pendingToolCalls = toolCalls;
      }

      // HITL plugin may have paused the agent in onModelResult
      if (this.isPaused) return;

      await this.executePendingTools(MAX_TOOLS_PER_TICK);

      if (this.isPaused) return;

      await this.scheduleStep();
    } catch (error: unknown) {
      this.runState.status = "error";
      this.runState.reason = String(
        error instanceof Error ? error.message : error
      );
      this.emit(AgentEventType.AGENT_ERROR, {
        "error.type": "runtime_error",
        "error.message": this.runState.reason,
        "error.stack": error instanceof Error ? error.stack : undefined,
      });
      // Disconnect from Agency WebSocket - run errored
      this.disconnectFromAgency();
    }
  }

  async action(req: Request) {
    const { type, ...payload } = await req.json<{
      type: string;
      payload: object;
    }>();

    // Core actions available to all agents
    if (type === "cancel") {
      if (this.runState.status !== "completed") {
        this.runState.status = "canceled";
        this.runState.reason = "user";
        this.emit(AgentEventType.AGENT_CANCELED, {});
        // Disconnect from Agency WebSocket - run canceled
        this.disconnectFromAgency();
      }
      return Response.json({ ok: true });
    }

    for (const plugin of this.plugins) {
      if (plugin.actions?.[type]) {
        const result = await plugin.actions[type](this.pluginContext, payload);
        return Response.json(result);
      }
    }
    return new Response(`unknown action: ${type}`, { status: 400 });
  }

  getState(_req: Request) {
    const { threadId, agencyId, agentType, request, createdAt } = this.info;
    
    // Handle uninitialized agent (not yet registered)
    if (!agentType) {
      return Response.json({
        state: {
          messages: [],
          threadId,
          agentType: null,
          model: null,
          tools: [],
          thread: { id: threadId, request, createdAt, agentType: null, agencyId },
        },
        run: this.runState,
        error: "Agent not yet initialized (missing agentType)",
      });
    }
    
    const { model, messages } = this;
    const tools = Object.values(this.tools).map((tool) => tool.meta);
    let state: AgentState = {
      messages,
      threadId,
      agentType,
      model,
      tools,
      thread: {
        id: threadId,
        request,
        createdAt,
        agentType,
        agencyId,
      },
    };
    for (const p of this.plugins) {
      if (p.state) {
        state = { ...state, ...p.state(this.pluginContext) };
      }
    }
    return Response.json({ state, run: this.runState });
  }

  getEvents(_req: Request) {
    return Response.json({ events: this.store.listEvents() });
  }

  // ==========================================================================
  // Event Sourcing Endpoints
  // ==========================================================================

  /**
   * GET /projection - Get projected state from events.
   * Supports time-travel via ?at=<seq> query parameter.
   * 
   * Query params:
   * - at: Sequence number to project up to (for time-travel)
   * - legacy: If "true", convert messages to legacy format
   */
  getProjection(req: Request) {
    const url = new URL(req.url);
    const atParam = url.searchParams.get("at");
    const legacyParam = url.searchParams.get("legacy");

    let projection: AgentProjection;
    let maxSeq: number | null;

    if (atParam) {
      // Time-travel: project up to specific sequence
      const atSeq = parseInt(atParam, 10);
      if (isNaN(atSeq)) {
        return Response.json({ error: "Invalid 'at' parameter" }, { status: 400 });
      }
      maxSeq = atSeq;

      // Use snapshot if available for optimization
      const snapshot = this.store.getSnapshotAt(atSeq);
      if (snapshot) {
        // Only load events after the snapshot, up to atSeq
        const recentEvents = this.store.getEventsAfter(snapshot.lastEventSeq)
          .filter((e) => (e.seq ?? 0) <= atSeq);
        projection = projectFromSnapshot(snapshot.state, snapshot.lastEventSeq, recentEvents);
      } else {
        // No snapshot, load all events up to atSeq
        const events = this.store.listEvents().filter((e) => (e.seq ?? 0) <= atSeq);
        projection = projectEvents(events);
      }
    } else {
      // Current state: use latest snapshot + recent events
      const currentMaxSeq = this.store.getMaxEventSeq();
      maxSeq = currentMaxSeq > 0 ? currentMaxSeq : null;
      const snapshot = this.store.getLatestSnapshot();
      if (snapshot) {
        const recentEvents = this.store.getEventsAfter(snapshot.lastEventSeq);
        projection = projectFromSnapshot(snapshot.state, snapshot.lastEventSeq, recentEvents);
      } else {
        const events = this.store.listEvents();
        projection = projectEvents(events);
      }
    }

    const eventCount = this.store.getEventCount();

    // Convert messages to legacy format if requested
    if (legacyParam === "true") {
      return Response.json({
        projection: {
          ...projection,
          messages: fromOTelMessages(projection.messages),
        },
        meta: {
          eventCount,
          atSeq: maxSeq,
        },
      });
    }

    return Response.json({
      projection,
      meta: {
        eventCount,
        atSeq: maxSeq,
      },
    });
  }

  /**
   * GET /export - Export all events for debugging or migration.
   * 
   * Query params:
   * - includeSnapshot: If "true", include latest snapshot
   */
  exportEvents(req: Request) {
    const url = new URL(req.url);
    const includeSnapshot = url.searchParams.get("includeSnapshot") === "true";

    const events = this.store.listEvents();
    const { threadId, agencyId, agentType, createdAt } = this.info;

    const exportData: {
      meta: {
        threadId: string;
        agencyId: string;
        agentType: string;
        createdAt: string;
        exportedAt: string;
        eventCount: number;
      };
      events: AgentEvent[];
      snapshot?: import("./projections").ProjectionSnapshot | null;
    } = {
      meta: {
        threadId,
        agencyId,
        agentType,
        createdAt,
        exportedAt: new Date().toISOString(),
        eventCount: events.length,
      },
      events,
    };

    if (includeSnapshot) {
      const snapshot = this.store.getLatestSnapshot();
      if (snapshot) {
        exportData.snapshot = snapshot;
      }
    }

    return Response.json(exportData);
  }

  /**
   * POST /fork - Fork this agent at a specific point in history.
   * Creates a new agent with events copied up to the specified sequence.
   * 
   * Request body:
   * - at?: number - Sequence number to fork from (defaults to latest)
   * - id?: string - Custom ID for the forked agent
   */
  async forkAgent(req: Request) {
    const body = await req.json<{ at?: number; id?: string }>().catch(() => ({} as { at?: number; id?: string }));
    const { at, id: customId } = body;

    const { agencyId, agentType, createdAt } = this.info;
    if (!agencyId || !agentType) {
      return Response.json({ error: "Agent not initialized" }, { status: 400 });
    }

    // Get events up to the specified sequence (or all if not specified)
    let events = this.store.listEvents();
    if (at !== undefined) {
      events = events.filter((e) => (e.seq ?? 0) <= at);
    }

    if (events.length === 0) {
      return Response.json({ error: "No events to fork" }, { status: 400 });
    }

    // Generate a new agent ID or use custom ID
    const forkId = customId ?? crypto.randomUUID();

    // Get the Agency to spawn the new agent
    const agencyStub = await getAgentByName(this.exports.Agency, agencyId);

    // Spawn the forked agent
    const spawnRes = await agencyStub.fetch(
      new Request("http://do/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentType,
          id: forkId,
          requestContext: {
            ...this.info.request,
            forkedFrom: this.info.threadId,
            forkedAt: at ?? this.store.getMaxEventSeq(),
          },
        }),
      })
    );

    if (!spawnRes.ok) {
      const text = await spawnRes.text();
      return Response.json({ error: `Failed to spawn fork: ${text}` }, { status: 500 });
    }

    const spawnData = (await spawnRes.json()) as { id: string };

    // Get the forked agent stub
    const forkStub = await getAgentByName(this.exports.HubAgent, spawnData.id);

    // Generate fork token for authentication
    const forkToken = this.generateForkToken(this.info.threadId, spawnData.id);

    // Copy events to the forked agent via a special endpoint
    const copyRes = await forkStub.fetch(
      new Request("http://do/internal/copy-events", {
        method: "POST",
        headers: { 
          "content-type": "application/json",
          "X-Fork-Token": forkToken,
        },
        body: JSON.stringify({
          events,
          sourceThreadId: this.info.threadId,
          forkedAt: at ?? this.store.getMaxEventSeq(),
        }),
      })
    );

    if (!copyRes.ok) {
      const text = await copyRes.text();
      return Response.json({ error: `Failed to copy events: ${text}` }, { status: 500 });
    }

    return Response.json({
      agent: {
        id: spawnData.id,
        agentType,
        createdAt: new Date().toISOString(),
      },
      eventsCopied: events.length,
    });
  }

  /**
   * Generate a fork token for authenticating internal copy-events requests.
   * Token format: base64(sourceThreadId:targetId:timestamp:signature)
   */
  private generateForkToken(sourceThreadId: string, targetId: string): string {
    const timestamp = Date.now();
    const payload = `${sourceThreadId}:${targetId}:${timestamp}`;
    // Use a simple HMAC-like signature with the agency ID as key
    // In production, this could use a proper signing key
    const signature = this.info.agencyId || "default";
    return btoa(`${payload}:${signature}`);
  }

  /**
   * Verify a fork token from an internal copy-events request.
   * Returns the source thread ID if valid, null otherwise.
   */
  private verifyForkToken(token: string, expectedTargetId: string): string | null {
    try {
      const decoded = atob(token);
      const parts = decoded.split(":");
      if (parts.length !== 4) return null;
      
      const [sourceThreadId, targetId, timestampStr, signature] = parts;
      const timestamp = parseInt(timestampStr, 10);
      
      // Verify target matches
      if (targetId !== expectedTargetId) return null;
      
      // Verify signature matches agency
      if (signature !== (this.info.agencyId || "default")) return null;
      
      // Token expires after 60 seconds
      if (Date.now() - timestamp > 60000) return null;
      
      return sourceThreadId;
    } catch {
      return null;
    }
  }

  /**
   * POST /internal/copy-events - Internal endpoint for receiving copied events during fork.
   * This is called by the source agent to populate a forked agent with its events.
   * Protected by X-Fork-Token header.
   */
  async copyEvents(req: Request) {
    // Verify fork token
    const forkToken = req.headers.get("X-Fork-Token");
    const myId = this.info.threadId || this.ctx.id.toString();
    
    if (!forkToken) {
      return Response.json({ error: "Missing X-Fork-Token header" }, { status: 401 });
    }
    
    const sourceThreadId = this.verifyForkToken(forkToken, myId);
    if (!sourceThreadId) {
      return Response.json({ error: "Invalid or expired fork token" }, { status: 403 });
    }

    const body = await req.json<{
      events: AgentEvent[];
      sourceThreadId: string;
      forkedAt: number;
    }>().catch(() => null);

    if (!body || !body.events || !Array.isArray(body.events)) {
      return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Verify the body's sourceThreadId matches the token
    if (body.sourceThreadId !== sourceThreadId) {
      return Response.json({ error: "Source thread ID mismatch" }, { status: 403 });
    }

    const { events, forkedAt } = body;

    if (events.length === 0) {
      return Response.json({ error: "No events to copy" }, { status: 400 });
    }

    // Store fork metadata in agent info (using validated sourceThreadId from token)
    this.info.forkedFrom = sourceThreadId;
    this.info.forkedAt = forkedAt;

    // Add all events to the store (they get new sequence numbers)
    const inserted = this.store.addEvents(events);

    return Response.json({
      ok: true,
      eventsCopied: inserted,
      sourceThreadId,
      forkedAt,
    });
  }

  /**
   * Create a snapshot of the current projection.
   * Should be called periodically to optimize future projections.
   */
  async createProjectionSnapshot(): Promise<void> {
    // Check if we need a snapshot
    const eventsSinceSnapshot = this.store.getEventsSinceLastSnapshot();
    if (!shouldSnapshot(eventsSinceSnapshot)) return;

    const maxSeq = this.store.getMaxEventSeq();
    if (maxSeq === 0) return;

    // Project current state using snapshot optimization
    const snapshot = this.store.getLatestSnapshot();
    let projection: AgentProjection;
    
    if (snapshot) {
      const recentEvents = this.store.getEventsAfter(snapshot.lastEventSeq);
      projection = projectFromSnapshot(snapshot.state, snapshot.lastEventSeq, recentEvents);
    } else {
      const events = this.store.listEvents();
      projection = projectEvents(events);
    }

    // Save snapshot
    this.store.addSnapshot(createSnapshot(projection, maxSeq));

    // Prune old snapshots
    this.store.pruneSnapshots(3);
  }

  async executePendingTools(maxTools: number) {
    let toolBatch: ToolCall[] = [];
    const calls = this.info.pendingToolCalls ?? [];
    if (calls.length <= maxTools) {
      toolBatch = calls;
      this.info.pendingToolCalls = [];
    } else {
      toolBatch = calls.slice(0, maxTools);
      this.info.pendingToolCalls = calls.slice(maxTools);
    }

    for (const call of toolBatch)
      await Promise.all(
        this.plugins.map((p) => p.onToolStart?.(this.pluginContext, call))
      );

    // Execute all tool calls in parallel
    const tools = this.tools;
    const toolResults = await Promise.all(
      toolBatch.map(async (call) => {
        this.emit(AgentEventType.TOOL_START, {
          "gen_ai.tool.name": call.name,
          "gen_ai.tool.call.id": call.id,
          "gen_ai.tool.arguments": call.args,
        });
        try {
          if (!tools[call.name]) {
            return { call, error: new Error(`Tool ${call.name} not found`) };
          }

          const out = await tools[call.name].execute(call.args, {
            agent: this,
            env: this.env,
            callId: call.id,
          });

          if (out === null) return { call, out };

          this.emit(AgentEventType.TOOL_FINISH, {
            "gen_ai.tool.name": call.name,
            "gen_ai.tool.call.id": call.id,
            "gen_ai.tool.response": out,
          });
          return { call, out };
        } catch (e: unknown) {
          return { call, error: e };
        }
      })
    );

    await Promise.all(
      toolResults.map(async (r) => {
        if ("error" in r && r.error) {
          const { error, call } = r;
          this.emit(AgentEventType.TOOL_ERROR, {
            "gen_ai.tool.name": call.name,
            "gen_ai.tool.call.id": call.id,
            "error.type": "tool_execution_error",
            "error.message": String(error instanceof Error ? error.message : error),
          });
          await Promise.all(
            this.plugins.map((p) =>
              p.onToolError?.(this.pluginContext, r.call, r.error as Error)
            )
          );
        } else if ("out" in r) {
          await Promise.all(
            this.plugins.map((p) =>
              p.onToolResult?.(this.pluginContext, r.call, r.out)
            )
          );
        }
      })
    );

    // Tool results are captured by TOOL_FINISH/TOOL_ERROR events above
    // No need for store.add() - messages are event-sourced
  }

  emit(type: AgentEventType | string, data: Record<string, unknown>) {
    const evt = {
      type,
      data,
      threadId: this.info.threadId || this.ctx.id.toString(),
      ts: new Date().toISOString(),
    } as AgentEvent;

    const seq = this.store.addEvent(evt);
    const event = { ...evt, seq };
    for (const p of this.plugins) {
      try {
        p.onEvent?.(this.pluginContext, event);
      } catch (e) {
        console.error(`Plugin ${p.name} onEvent error:`, e);
      }
    }
    // Broadcast to direct WebSocket subscribers (UI clients connected to this agent)
    this.broadcast(JSON.stringify(event));
    // Relay to Agency via WebSocket (if connected)
    this.relayEventToAgency(event);
  }

  /**
   * Emit an INFERENCE_DETAILS event following OTel GenAI semantic conventions.
   * This event captures complete input/output for event sourcing and replay.
   */
  private emitInferenceDetails(
    req: import("../types").ModelRequest,
    res: import("../providers").ModelResult
  ) {
    // Build system instructions from system prompt
    const systemInstructions: SystemInstruction[] = req.systemPrompt
      ? [{ type: "text", content: req.systemPrompt }]
      : [];

    // Convert messages to OTel format
    const inputMessages = toOTelMessages(req.messages);
    const outputMessage = toOTelMessage(res.message);

    // Determine finish reason
    const finishReasons = outputMessage.finish_reason
      ? [outputMessage.finish_reason]
      : undefined;

    const data: InferenceDetailsData = {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": req.model,
      "gen_ai.conversation.id": this.info.threadId,
      "gen_ai.input.messages": inputMessages,
      "gen_ai.output.messages": [outputMessage],
      "gen_ai.system_instructions": systemInstructions.length > 0 ? systemInstructions : undefined,
      "gen_ai.tool.definitions": req.toolDefs,
      "gen_ai.usage.input_tokens": res.usage?.promptTokens,
      "gen_ai.usage.output_tokens": res.usage?.completionTokens,
      "gen_ai.response.model": req.model,
      "gen_ai.response.finish_reasons": finishReasons,
    };

    this.emit(AgentEventType.INFERENCE_DETAILS, data);
  }

  /**
   * Connect to the Agency via WebSocket for event relay.
   * Called when a run starts. The Agency stays awake while agents have active runs.
   */
  protected async connectToAgency(): Promise<void> {
    const agencyId = this.info.agencyId;
    if (!agencyId || this._agencyWs || this._agencyWsConnecting) return;

    this._agencyWsConnecting = true;
    try {
      const agencyStub = await getAgentByName(this.exports.Agency, agencyId);
      
      // Make a WebSocket upgrade request to the Agency with agent identification in headers
      const resp = await agencyStub.fetch("http://do/internal/agent-ws", {
        headers: {
          "Upgrade": "websocket",
          "X-Agent-Id": this.info.threadId,
          "X-Agent-Type": this.info.agentType,
        },
      });

      const ws = resp.webSocket;
      if (!ws) {
        console.error("[Agent→Agency WS] No WebSocket in response");
        this._agencyWsConnecting = false;
        return;
      }

      // Accept the WebSocket connection
      ws.accept();
      this._agencyWs = ws;
      this._agencyWsConnecting = false;

      // Handle close
      ws.addEventListener("close", () => {
        this._agencyWs = null;
      });

      ws.addEventListener("error", () => {
        this._agencyWs = null;
      });
    } catch (e) {
      console.error("[Agent→Agency WS] Failed to connect:", e);
      this._agencyWsConnecting = false;
    }
  }

  /**
   * Disconnect from the Agency WebSocket.
   * Called when a run completes, errors, or is canceled.
   */
  protected disconnectFromAgency(): void {
    if (this._agencyWs) {
      try {
        this._agencyWs.close(1000, "run_ended");
      } catch {
        // Ignore close errors
      }
      this._agencyWs = null;
    }
  }

  /**
   * Relay an event to the Agency via WebSocket.
   */
  private relayEventToAgency(event: AgentEvent & { seq?: number }): void {
    if (!this._agencyWs) return;

    const relayEvent: AgencyRelayEvent = {
      ...event,
      agentId: this.info.threadId,
      agentType: this.info.agentType,
    };

    try {
      this._agencyWs.send(JSON.stringify(relayEvent));
    } catch (e) {
      // WebSocket might have closed, ignore
      console.debug("[Agent→Agency WS] Send failed:", e);
    }
  }
}
