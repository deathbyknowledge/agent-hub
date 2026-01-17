import type { env } from "cloudflare:workers";
import type { ModelPlanBuilder } from "./plan";
import type { HubAgent } from "./agent";
import type { Provider } from "./providers";
import type { Agency } from "./agency";
import type { AgentEvent } from "./events";

/** Lifecycle status of an agent run. */
export type RunStatus =
  | "idle"
  | "registered"
  | "running"
  | "paused"
  | "completed"
  | "canceled"
  | "error";

/** Mutable state tracking the progress of an agent run. */
export type RunState = {
  status: RunStatus;
  step: number;
  reason?: string;
  nextAlarmAt?: number | null;
};

/** Full observable state of an agent, returned via the `/state` endpoint. */
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

// =============================================================================
// OTel-compliant message types
// See: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
// =============================================================================

/** Content modality for binary/media parts */
export type MessageModality = "image" | "video" | "audio";

/** Text content sent to or received from the model */
export type TextPart = {
  type: "text";
  content: string;
};

/** Tool call requested by the model */
export type ToolCallPart = {
  type: "tool_call";
  id: string;
  name: string;
  arguments: unknown;
};

/** Tool call result sent back to the model */
export type ToolCallResponsePart = {
  type: "tool_call_response";
  id: string;
  response: unknown;
};

/** Reasoning/thinking content (e.g., DeepSeek thinking blocks) */
export type ReasoningPart = {
  type: "reasoning";
  content: string;
};

/** Inline binary data (base64 encoded) */
export type BlobPart = {
  type: "blob";
  modality: MessageModality;
  content: string;
  mime_type?: string;
};

/** External file reference by URI */
export type UriPart = {
  type: "uri";
  modality: MessageModality;
  uri: string;
  mime_type?: string;
};

/** External file reference by provider file ID */
export type FilePart = {
  type: "file";
  modality: MessageModality;
  file_id: string;
  mime_type?: string;
};

/** Union of all message part types */
export type MessagePart =
  | TextPart
  | ToolCallPart
  | ToolCallResponsePart
  | ReasoningPart
  | BlobPart
  | UriPart
  | FilePart;

/** Message role following OTel spec */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** Reason for finishing generation (OTel spec) */
export type FinishReason = "stop" | "length" | "content_filter" | "tool_call" | "error";

/**
 * OTel-compliant message format with parts array.
 * This is the canonical message format for event sourcing.
 */
export type OTelMessage = {
  role: MessageRole;
  parts: MessagePart[];
  name?: string;
  finish_reason?: FinishReason;
  ts?: string;
};

/** System instruction part (for gen_ai.system_instructions) */
export type SystemInstruction = {
  type: "text";
  content: string;
};

export type ToolJsonSchema = Record<string, unknown>;

/** Metadata describing a tool for the LLM (name, description, JSON Schema). */
export type ToolMeta = {
  name: string;
  description?: string;
  parameters?: ToolJsonSchema;
};

export type ChatMessageBase = {
  /** Timestamp when the message was created (ISO string). */
  ts?: string;
};

/**
 * Legacy message format - flat structure with content/toolCalls fields.
 * @deprecated Use OTelMessage with parts[] for new code.
 */
export type LegacyChatMessage = ChatMessageBase &
  (
    | { role: "system" | "user"; content: string }
    | { role: "assistant"; reasoning?: string; content: string }
    | { role: "assistant"; reasoning?: string; toolCalls: ToolCall[] }
    | { role: "tool"; content: string; toolCallId: string }
  );

/**
 * A single message in the conversation.
 * Currently uses legacy format for backward compatibility.
 * Will migrate to OTelMessage in future versions.
 */
export type ChatMessage = LegacyChatMessage;

/** Request body for the `/invoke` endpoint. */
export interface InvokeBody {
  threadId?: string;
  messages?: ChatMessage[];
  files?: Record<string, string>;
  idempotencyKey?: string;
  agentType?: string;
  tags?: string[];
  vars?: Record<string, unknown>;
}

/** Request payload sent to the LLM provider. */
export interface ModelRequest {
  model: string;
  systemPrompt?: string;
  messages: ChatMessage[];
  tools?: string[];
  toolDefs?: ToolMeta[];
  toolChoice?: "auto" | { type: "function"; function: { name: string } };
  responseFormat?: "text" | "json" | { schema: unknown };
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

/** HTTP request context captured when a thread is created. */
export type ThreadRequestContext = {
  userAgent?: string;
  ip?: string;
  referrer?: string;
  origin?: string;
  cf?: Record<string, unknown>;
};

/** Immutable metadata for an agent thread. */
export interface ThreadMetadata {
  id: string;
  createdAt: string;
  request: ThreadRequestContext;
  agentType: string;
  agencyId: string;
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

/**
 * Defines an agent's behavior: prompt, model, capabilities, and vars.
 * Registered with an agency and used to spawn agent instances.
 */
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

/** Analytics Engine dataset binding for metrics */
export interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

/** Environment bindings required by the AgentHub runtime. */
export interface AgentEnv {
  HUB_AGENT: DurableObjectNamespace<HubAgent>;
  AGENCY: DurableObjectNamespace<Agency>;
  LLM_API_KEY?: string;
  LLM_API_BASE?: string;
  LLM_RETRY_MAX?: string | number;
  LLM_RETRY_BACKOFF_MS?: string | number;
  LLM_RETRY_MAX_BACKOFF_MS?: string | number;
  LLM_RETRY_JITTER_RATIO?: string | number;
  LLM_RETRY_STATUS_CODES?: string;
  FS?: R2Bucket;
  SANDBOX?: DurableObjectNamespace;
  /** Analytics Engine dataset for agent metrics */
  METRICS?: AnalyticsEngineDataset;
  /** Cloudflare Account ID (for querying Analytics Engine SQL API) */
  CF_ACCOUNT_ID?: string;
  /** API Token with Analytics Read permission (for querying Analytics Engine SQL API) */
  CF_API_TOKEN?: string;
}

/** Context passed to plugin hooks, providing access to the agent and tool registration. */
export type PluginContext = {
  agent: HubAgent;
  env: AgentEnv;
  registerTool: <T>(tool: Tool<T>) => void;
};

/** Declares a variable that a plugin or tool expects to be set. */
export interface VarHint {
  name: string;
  required?: boolean;
  description?: string;
}

/**
 * Extends agent behavior with lifecycle hooks, tools, state, and actions.
 * Plugins are matched to agents via tags in the blueprint's `capabilities`.
 */
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

/**
 * A callable tool exposed to the LLM. Create via `tool()` from `agent-hub`.
 */
export interface Tool<TInput = unknown> {
  meta: ToolMeta;
  execute: (input: TInput, ctx: ToolContext) => Promise<string | object | null>;
  varHints?: VarHint[];
  /** Intrinsic tags for this tool. Merged with tags provided to `addTool()`. */
  tags?: string[];
}

/** Context passed to a tool's execute function. */
export type ToolContext = {
  agent: HubAgent;
  env: typeof env;
  callId: string;
};

export type Exports = {
  HubAgent: DurableObjectNamespace<HubAgent>;
  Agency: DurableObjectNamespace<Agency>;
};

export type CfCtx = ExecutionContext & { exports: Exports };
