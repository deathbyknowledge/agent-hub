import type { env } from "cloudflare:workers";
import type { ModelPlanBuilder } from "./plan";
import type { HubAgent } from "./agent";
import type { Provider } from "./providers";
import type { Agency } from "./agency";

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

export type AgentConfig<T = Record<string, unknown>> = T;

export type AgentState = {
  messages: ChatMessage[];
  tools: ToolMeta[];
  thread: ThreadMetadata;
  threadId?: string;
  parent?: ParentInfo;
  agentType?: string;
  model?: string;
} & Record<string, unknown>;

export interface ApproveBody {
  approved: boolean;
  modifiedToolCalls?: ToolCall[];
}

export type Todo = {
  content: string;
  status: "pending" | "in_progress" | "completed";
};

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

export type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "assistant"; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

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

/**
 * Parent info for subagent relationships.
 * NOTE: This is now populated by consumer plugins (subagents/subagent-reporter),
 * not by the core runtime.
 */
export interface ParentInfo {
  threadId: string;
  token: string;
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
  parent?: ParentInfo;
  agentType: string;
  agencyId: string;
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

export type AgentBlueprint<TConfig = Record<string, unknown>> = {
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
  config?: AgentConfig<TConfig>;
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
  provider: Provider;
  agent: HubAgent;
  env: AgentEnv;
  registerTool: <T>(tool: Tool<T>) => void;
};

export interface AgentPlugin<TConfig = unknown> {
  actions?: Record<
    string,
    (ctx: PluginContext, payload: unknown) => Promise<unknown>
  >;

  name: string;
  __configType?: TConfig;

  state?: (ctx: PluginContext) => Record<string, unknown>;

  onInit?(ctx: PluginContext): Promise<void>;

  onTick?(ctx: PluginContext): Promise<void>;

  beforeModel?(ctx: PluginContext, plan: ModelPlanBuilder): Promise<void>;

  onModelResult?(ctx: PluginContext, res: { message: ChatMessage }): Promise<void>;

  onToolStart?(ctx: PluginContext, call: ToolCall): Promise<void>;
  onToolResult?(ctx: PluginContext, call: ToolCall, result: unknown): Promise<void>;
  onToolError?(ctx: PluginContext, call: ToolCall, error: Error): Promise<void>;

  onResume?(ctx: PluginContext, reason: string, payload: unknown): Promise<void>;

  onRunComplete?(ctx: PluginContext, result: { final: string }): Promise<void>;

  tags: string[];
}

export interface Tool<TInput = unknown> {
  meta: ToolMeta;
  execute: (input: TInput, ctx: ToolContext) => Promise<string | object | null>;
}

export type ToolContext = {
  agent: HubAgent;
  env: typeof env;
  callId: string;
};
