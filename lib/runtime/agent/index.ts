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
} from "../types";
import { Agent, type AgentContext, getAgentByName } from "agents";
import { type AgentEvent, AgentEventType } from "../events";
import { Store } from "./store";
import { PersistedObject } from "../persisted";
import { AgentFileSystem } from "../fs";
import { ModelPlanBuilder } from "../plan";
import { DEFAULT_MAX_ITERATIONS, MAX_TOOLS_PER_TICK } from "../config";

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

  get messages() {
    return this.store.getContext(1000);
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

      if (body.messages?.length) this.store.add(body.messages);

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
        this.emit(AgentEventType.RUN_STARTED, {});
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
          error: this.runState.reason,
          step: this.runState.step,
        });
        return;
      }

      this.emit(AgentEventType.RUN_TICK, {
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

        this.store.add(res.message);

        let toolCalls: ToolCall[] = [];
        let reply = "";

        if ("toolCalls" in res.message) toolCalls = res.message.toolCalls;
        if ("content" in res.message) reply = res.message.content;

        // Emit assistant message event so UI can update incrementally
        this.emit(AgentEventType.ASSISTANT_MESSAGE, {
          content: reply || undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            args: tc.args,
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
          // Disconnect from Agency WebSocket - run is done
          this.disconnectFromAgency();
          return;
        }

        this.info.pendingToolCalls = toolCalls;
      }

      await this.executePendingTools(MAX_TOOLS_PER_TICK);

      if (this.isPaused) return;

      await this.scheduleStep();
    } catch (error: unknown) {
      this.runState.status = "error";
      this.runState.reason = String(
        error instanceof Error ? error.message : error
      );
      this.emit(AgentEventType.AGENT_ERROR, {
        error: this.runState.reason,
        stack: error instanceof Error ? error.stack : undefined,
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
        this.emit(AgentEventType.RUN_CANCELED, {});
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
        this.emit(AgentEventType.TOOL_STARTED, {
          toolName: call.name,
          args: call.args,
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

          this.emit(AgentEventType.TOOL_OUTPUT, {
            toolName: call.name,
            toolCallId: call.id,
            output: out,
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
            toolName: call.name,
            toolCallId: call.id,
            error: String(error instanceof Error ? error.message : error),
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

    const messages = toolResults
      .filter((r) => r.out !== null || !!r.error)
      .map(({ call, out, error }) => {
        const content = error
          ? `Error: ${error instanceof Error ? error.message : String(error)}`
          : typeof out === "string"
            ? out
            : JSON.stringify(out ?? "Tool had no output");
        return {
          role: "tool" as const,
          content,
          toolCallId: call.id,
        };
      });
    this.store.add(messages);
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
