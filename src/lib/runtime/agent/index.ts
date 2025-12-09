import { type Provider } from "../providers";
import type {
  AgentPlugin,
  ToolHandler,
  ToolCall,
  InvokeBody,
  PluginContext,
  ThreadMetadata,
  AgentState,
  ThreadRequestContext,
  RunState,
  AgentConfig,
  AgentBlueprint,
  AgentEnv,
} from "../types";
import { Agent, type AgentContext } from "agents";
import { getToolMeta } from "../tools";
import { type AgentEvent, AgentEventType } from "../events";
import { step } from "./step";
import { Store } from "./store";
import { PersistedObject } from "../config";
import { AgentFileSystem } from "../fs";

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
  protected _tools: Record<string, ToolHandler> = {};
  private _fs: AgentFileSystem | null = null;

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
    this.store = new Store(sql, kv);
    this.store.init();
    this.info = PersistedObject<Info>(kv, { prefix: "_info" });
    this.runState = PersistedObject<RunState>(kv, {
      prefix: "_runState",
      defaults: {
        status: "registered",
      },
    });
    // Open-typed persisted metadata for plugin use
    this.vars = PersistedObject<Record<string, unknown>>(kv, {
      prefix: "_vars",
    });
  }

  abstract get blueprint(): AgentBlueprint;
  abstract get plugins(): AgentPlugin[];
  abstract get tools(): Record<string, ToolHandler>;
  abstract get systemPrompt(): string;
  abstract get model(): string;
  abstract get config(): AgentConfig;
  abstract get provider(): Provider;
  abstract onRegister(meta: ThreadMetadata): Promise<void>;

  get messages() {
    return this.store.listMessages();
  }

  /**
   * R2-backed filesystem with per-agent home directory and shared spce.
   * Returns null if FS binding is not configured.
   */
  get fs(): AgentFileSystem | null {
    // Return cached instance
    if (this._fs) return this._fs;

    // Need R2 bucket binding
    const bucket = this.env.FS;
    if (!bucket) return null;

    // Need agent identity (set after registration)
    const agencyId = this.info.agencyId;
    const agentId = this.info.threadId;
    if (!agencyId || !agentId) return null;

    this._fs = new AgentFileSystem(bucket, { agencyId, agentId });
    return this._fs;
  }

  get pluginContext(): PluginContext {
    return {
      agent: this,
      provider: this.provider,
      env: this.env,
      registerTool: (tool: ToolHandler) => {
        const name = getToolMeta(tool)?.name;
        if (!name) throw new Error("Tool missing name: use defineTool(...)");

        this._tools[name] = tool;
      },
    };
  }

  get isPaused(): boolean {
    return this.runState.status === "paused";
  }

  get isDone(): boolean {
    const last = this.store.lastAssistant();
    return (
      !!last &&
      (!("toolCalls" in last) || last.toolCalls?.length === 0) &&
      "content" in last &&
      last.content.trim().length > 0
    );
  }

  /**
   * Emit an event. Accepts core AgentEventType or custom string types for middleware events.
   */
  emit(type: AgentEventType | string, data: Record<string, unknown>) {
    const evt = {
      type,
      data,
      threadId: this.info.threadId || this.ctx.id.toString(),
      ts: new Date().toISOString(),
    } as AgentEvent;

    const seq = this.store.addEvent(evt);

    // broadcast to connected clients if any
    this.broadcast(JSON.stringify({ ...evt, seq }));
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
      default:
        return new Response("not found", { status: 404 });
    }
  }

  async action(req: Request) {
    const { type, ...payload } = await req.json<{
      type: string;
      payload: object;
    }>();

    for (const plugin of this.plugins) {
      if (plugin.actions?.[type]) {
        const result = await plugin.actions[type](this.pluginContext, payload);
        return Response.json(result);
      }
    }
    return new Response(`unknown action: ${type}`, { status: 400 });
  }

  // TODO: revisit registration/init
  async registerThread(req: Request) {
    try {
      const metadata = await req.json<ThreadMetadata>().catch(() => null);
      if (!metadata || !metadata.id) {
        return new Response("invalid metadata", { status: 400 });
      }

      // persist ID
      if (!this.info.threadId) {
        this.info.threadId = metadata.id;
      }

      // persist agent configuration
      this.info.createdAt = metadata.createdAt;
      this.info.request = metadata.request;

      // Critical: Set the type so dynamic getters (tools/prompt) work
      if (metadata.agentType) {
        this.info.agentType = metadata.agentType;
      }

      // Call onRegister hook to fetch blueprint and initialize
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

      // Merge invoke meta into persisted meta
      if (body.vars) {
        Object.assign(this.vars, body.vars);
      }

      // Merge input into state
      if (body.messages?.length) this.store.appendMessages(body.messages);

      // Add files into agent's home folder.
      // TODO: allow any byte stream?
      if (body.files && Array.isArray(body.files)) {
        await Promise.all(
          Object.entries(body.files).map(([filename, content]) =>
            this.fs?.writeFile(`~/${filename}`, content)
          )
        );
      }

      const runState = this.runState;
      // Start or continue run
      if (
        !runState ||
        ["completed", "canceled", "error", "registered"].includes(
          runState.status
        )
      ) {
        runState.status = "running";
        runState.step = this.runState?.step ?? 0;
        runState.nextAlarmAt = null;
        this.emit(AgentEventType.RUN_STARTED, {});
      } else if (runState.status === "paused") {
        // remains paused; client may be trying to push more messages—fine.
      }

      await this.ensureScheduled();
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

  getState(_req: Request) {
    const { threadId, agencyId, agentType, request, createdAt } = this.info;
    const { model } = this;
    const tools = Object.values(this.tools).map((tool) => {
      const meta = getToolMeta(tool);
      if (!meta) throw new Error(`Tool ${tool.name} has no metadata`);
      return meta;
    });
    let state: AgentState = {
      messages: this.store.listMessages(),
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

  // === Scheduler: ensure an alarm and perform ticks ===
  async ensureScheduled() {
    const runState = this.runState;
    if (!runState || runState.status !== "running") return;
    const schedules = this.getSchedules();
    if (!schedules.length) {
      const now = new Date();
      runState.nextAlarmAt = now.getTime();
      await this.schedule(now, "run");
    }
  }

  popPendingToolCalls(maxTools: number) {
    const calls = this.info.pendingToolCalls ?? [];
    if (calls.length <= maxTools) {
      this.info.pendingToolCalls = [];
      return calls;
    }
    const out = calls.slice(0, maxTools);
    this.info.pendingToolCalls = calls.slice(maxTools);
    return out;
  }

  async executePendingTools(maxTools: number) {
    const toolBatch = this.popPendingToolCalls(maxTools);

    const plugins = this.plugins;
    for (const call of toolBatch)
      await Promise.all(plugins.map((p) => p.onToolStart?.(this.pluginContext, call)));

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

          const out = await tools[call.name](call.args, {
            agent: this,
            env: this.env,
            callId: call.id,
          });

          if (out === null) return { call, out };
          // Regular tool result
          this.emit(AgentEventType.TOOL_OUTPUT, {
            toolName: call.name,
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
            error: String(error instanceof Error ? error.message : error),
          });
          await Promise.all(
            plugins.map((p) =>
              p.onToolError?.(this.pluginContext, r.call, r.error as Error)
            )
          );
        } else if ("out" in r) {
          await Promise.all(
            plugins.map((p) => p.onToolResult?.(this.pluginContext, r.call, r.out))
          );
        }
      })
    );

    // Append tool messages for regular (non-spawn) results
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
    this.store.appendMessages(messages);
  }

  async run() {
    const runState = this.runState;
    if (!runState || runState.status !== "running") return;

    // One bounded tick to avoid subrequest limits:
    //   - at most 1 model call
    //   - then execute up to N tool calls (N small)
    const TOOLS_PER_TICK = 25;

    this.emit(AgentEventType.RUN_TICK, {
      step: runState.step,
    });
    runState.step += 1;

    const hasPendingTools = (this.info.pendingToolCalls ?? []).length > 0;

    if (!hasPendingTools && !this.isPaused) {
      try {
        await step(this.plugins, this.pluginContext);
      } catch (error: unknown) {
        runState.status = "error";
        runState.reason = String(
          error instanceof Error ? error.message : error
        );
        this.emit(AgentEventType.AGENT_ERROR, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return;
      }

      if (this.isPaused) return;

      // If the agent didn't call any more tools, we consider the run complete.
      if (this.isDone) {
        runState.status = "completed";
        const last = this.store.lastAssistant();
        const final = last && "content" in last ? last.content : "";

        for (const plugin of this.plugins) {
          await plugin.onRunComplete?.(this.pluginContext, { final });
        }

        this.emit(AgentEventType.AGENT_COMPLETED, { result: last });
        return;
      }
    }

    // Execute pending tools
    await this.executePendingTools(TOOLS_PER_TICK);

    // If paused (by middleware), don't proceed further
    if (this.isPaused) {
      return;
    }

    const pending = this.info.pendingToolCalls ?? [];
    // If we consumed some but still have pending tool calls, reschedule to continue
    if (pending.length > 0) {
      await this.reschedule();
      return;
    }

    // Otherwise, reschedule for next model call
    await this.reschedule();
  }

  async reschedule() {
    // Yield to respect per-event subrequest limits; schedule next tick immediately
    const runState = this.runState;
    if (!runState) return;
    const now = new Date();
    runState.nextAlarmAt = now.getTime();
    await this.schedule(now, "run");
  }
}
