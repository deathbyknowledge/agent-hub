import type { env } from "cloudflare:workers";
import type { ModelPlanBuilder } from "./plan";
import type { HubAgent } from "./agent";
import type { Provider } from "./providers";
import type { Agency } from "./agency";
import type { AgentEvent } from "./events";

export type RunStatus =
  | "idle"
  | "registered"
  | "running"
  | "paused"
  | "completed"
  | "canceled"
  | "error";

export type RunState = {
  status: RunStatus;
  step: number; // how many steps executed
  reason?: string; // pause/cancel reason
  nextAlarmAt?: number | null; // ms epoch
};

export type AgentState = {
  messages: ChatMessage[];
  tools: ToolMeta[];
  thread: ThreadMetadata;
  threadId?: string;
  agentType?: string;
  model?: string;
} & Record<string, unknown>;

export interface ApproveBody {
  approved: boolean;
  modifiedToolCalls?: ToolCall[];
}

export type ToolCall = {
  name: string;
  args: unknown;
  id: string;
};

export type ToolJsonSchema = Record<string, unknown>;

export type ToolMeta = {
  name: string;
  description?: string; // this is where *_TOOL_DESCRIPTION goes
  parameters?: ToolJsonSchema; // JSON Schema for the args (OpenAI/Anthropic)
};

export type ChatMessageBase = {
  /** Timestamp when the message was created (ISO string), populated from store */
  ts?: string;
};

export type ChatMessage = ChatMessageBase &
  (
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; reasoning?: string; content: string }
    | { role: "assistant"; reasoning?: string; toolCalls: ToolCall[] }
    | { role: "tool"; content: string; toolCallId: string }
  );

export interface InvokeBody {
  threadId?: string;
  messages?: ChatMessage[]; // optional new user messages
  files?: Record<string, string>; // optional files to merge into VFS
  idempotencyKey?: string; // dedupe protection
  agentType?: string; // optional subagent type
  /** Dynamic plugin tags for this invocation */
  tags?: string[];
  /** Arbitrary vars accessible to plugins */
  vars?: Record<string, unknown>;
}

export interface ModelRequest {
  model: string; // provider:model-id (adapter resolves)
  systemPrompt?: string; // big system prompt (may be dynamic)
  messages: ChatMessage[]; // excludes systemPrompt
  tools?: string[]; // exposed tool names
  toolDefs?: ToolMeta[];
  toolChoice?: "auto" | { type: "function"; function: { name: string } };
  responseFormat?: "text" | "json" | { schema: unknown };
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

export type ThreadRequestContext = {
  userAgent?: string;
  ip?: string;
  referrer?: string;
  origin?: string;
  cf?: Record<string, unknown>;
};

export interface ThreadMetadata {
  id: string;
  createdAt: string;
  request: ThreadRequestContext;
  agentType: string;
  agencyId: string;
  /** Agency-level vars to inherit (merged with lower priority than agent vars) */
  vars?: Record<string, unknown>;
}

export interface CreateThreadRequest {
  agentType?: string;
  metadata?: Record<string, unknown>;
}

export type SubagentLinkStatus = "waiting" | "completed" | "canceled";

export interface SubagentLink {
  childThreadId: string;
  token: string;
  status: SubagentLinkStatus;
  createdAt: number;
  completedAt?: number;
  report?: string;
  toolCallId?: string;
}

type BlueprintStatus = "active" | "draft" | "disabled";

export type AgentBlueprint = {
  name: string;
  description: string;
  prompt: string;
  /**
   * Capabilities determine which tools and plugins are available to this agent.
   * - `@tag` - includes all tools/plugins with that tag (e.g., `@security`, `@default`)
   * - `name` - includes a specific tool/plugin by name (e.g., `write_file`, `planning`)
   */
  capabilities: string[];
  model?: string;
  /**
   * Variables accessible to plugins and the agent at runtime.
   * These are merged with agency vars and can be overridden at registration/invocation.
   */
  vars?: Record<string, unknown>;
  status?: BlueprintStatus;
  createdAt?: string; // ISO
  updatedAt?: string; // ISO
};

export interface AgentEnv {
  HUB_AGENT: DurableObjectNamespace<HubAgent>;
  AGENCY: DurableObjectNamespace<Agency>;
  LLM_API_KEY?: string;
  LLM_API_BASE?: string;
  /** R2 bucket for persistent agent filesystem */
  FS?: R2Bucket;
  /** Sandbox Durable Object for ephemeral container execution */
  SANDBOX?: DurableObjectNamespace;
}

export type PluginContext = {
  agent: HubAgent;
  env: AgentEnv;
  registerTool: <T>(tool: Tool<T>) => void;
};

export interface VarHint {
  name: string;
  required?: boolean;
  description?: string;
}

export interface AgentPlugin {
  actions?: Record<
    string,
    (ctx: PluginContext, payload: unknown) => Promise<unknown>
  >;

  name: string;

  /** Hints about vars this plugin needs */
  varHints?: VarHint[];

  /**
   * Agents with this blueprint will include this plugin's state in their state.
   */
  state?: (ctx: PluginContext) => Record<string, unknown>;

  /**
   * Hook called when an agent with this plugin is registered. Only called once.
   */
  onInit?(ctx: PluginContext): Promise<void>;

  /**
   * Hook called at the beginning of each tick. Once per each LLM -> tool exec iterations.
   */
  onTick?(ctx: PluginContext): Promise<void>;

  /**
   * Hook called before the model is invoked. Useful to add or modify the model request.
   * e.g. add tools, modify system prompt, etc.
   */
  beforeModel?(ctx: PluginContext, plan: ModelPlanBuilder): Promise<void>;

  /**
   * Hook called once the LLM response is received and before any tools are executed.
   */
  onModelResult?(
    ctx: PluginContext,
    res: { message: ChatMessage }
  ): Promise<void>;

  /**
   * Hook called before a tool is executed. Executed once per tool call.
   */
  onToolStart?(ctx: PluginContext, call: ToolCall): Promise<void>;

  /**
   * Hook called after a tool is executed. Executed once per tool call.
   */
  onToolResult?(
    ctx: PluginContext,
    call: ToolCall,
    result: unknown
  ): Promise<void>;

  /**
   * Hook called after a tool is executed. Executed once per tool call.
   */
  onToolError?(ctx: PluginContext, call: ToolCall, error: Error): Promise<void>;

  /**
   * Hook called when the agent has no more tools to call and has returned a final text.
   */
  onRunComplete?(ctx: PluginContext, result: { final: string }): Promise<void>;

  /**
   * Hook called when the agent emits an event.
   */
  onEvent?(ctx: PluginContext, event: AgentEvent): void;

  tags: string[];
}

export interface Tool<TInput = unknown> {
  meta: ToolMeta;
  execute: (input: TInput, ctx: ToolContext) => Promise<string | object | null>;
  varHints?: VarHint[];
}

export type ToolContext = {
  agent: HubAgent;
  env: typeof env;
  callId: string;
};

type Exports = {
  HubAgent: DurableObjectNamespace<HubAgent>;
  Agency: DurableObjectNamespace<Agency>;
};

export type CfCtx = ExecutionContext & { exports: Exports };
