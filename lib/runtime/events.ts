/**
 * Event types following OpenTelemetry GenAI semantic conventions.
 * See: https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * 
 * Naming convention:
 * - gen_ai.agent.* - Agent lifecycle events
 * - gen_ai.chat.* - LLM/model call events (OTel uses "chat" for inference)
 * - gen_ai.tool.* - Tool execution events
 * - gen_ai.content.* - Content/message events
 * - gen_ai.client.* - Client-side operation events
 */

import type {
  OTelMessage,
  SystemInstruction,
  ToolMeta,
  FinishReason,
} from "./types";
export enum AgentEventType {
  // Agent lifecycle (maps to OTel gen_ai.agent spans)
  AGENT_INVOKED = "gen_ai.agent.invoked",       // Agent run started
  AGENT_STEP = "gen_ai.agent.step",             // Agent tick/iteration
  AGENT_PAUSED = "gen_ai.agent.paused",         // Waiting for input (HITL, subagent, etc)
  AGENT_RESUMED = "gen_ai.agent.resumed",       // Resumed after pause
  AGENT_COMPLETED = "gen_ai.agent.completed",   // Agent finished successfully
  AGENT_ERROR = "gen_ai.agent.error",           // Agent failed
  AGENT_CANCELED = "gen_ai.agent.canceled",     // Agent was canceled

  // Model/LLM calls (maps to OTel gen_ai.chat spans)
  CHAT_START = "gen_ai.chat.start",             // LLM request started
  CHAT_CHUNK = "gen_ai.chat.chunk",             // Streaming chunk received
  CHAT_FINISH = "gen_ai.chat.finish",           // LLM response completed

  // Tool execution (maps to OTel gen_ai.execute_tool spans)
  TOOL_START = "gen_ai.tool.start",             // Tool execution started
  TOOL_FINISH = "gen_ai.tool.finish",           // Tool execution completed
  TOOL_ERROR = "gen_ai.tool.error",             // Tool execution failed

  // Content events
  CONTENT_MESSAGE = "gen_ai.content.message",   // Assistant message (text or tool calls)
  USER_MESSAGE = "gen_ai.content.user_message", // User input message

  // Inference operation details (OTel standard event for event sourcing)
  // See: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
  INFERENCE_DETAILS = "gen_ai.client.inference.operation.details",

  // System/infrastructure events (not OTel standard, but useful)
  SYSTEM_THREAD_CREATED = "gen_ai.system.thread_created",
  SYSTEM_REQUEST_ACCEPTED = "gen_ai.system.request_accepted",
  SYSTEM_CHECKPOINT = "gen_ai.system.checkpoint",

  // Plugin hooks (not OTel standard, internal use)
  PLUGIN_HOOK = "gen_ai.plugin.hook",
}

// Legacy event type names for backward compatibility
// Maps old names to new OTel names
export const LegacyEventTypeMap: Record<string, AgentEventType> = {
  "thread.created": AgentEventType.SYSTEM_THREAD_CREATED,
  "request.accepted": AgentEventType.SYSTEM_REQUEST_ACCEPTED,
  "run.started": AgentEventType.AGENT_INVOKED,
  "run.tick": AgentEventType.AGENT_STEP,
  "run.paused": AgentEventType.AGENT_PAUSED,
  "run.resumed": AgentEventType.AGENT_RESUMED,
  "run.canceled": AgentEventType.AGENT_CANCELED,
  "agent.started": AgentEventType.AGENT_INVOKED,
  "agent.completed": AgentEventType.AGENT_COMPLETED,
  "agent.error": AgentEventType.AGENT_ERROR,
  "checkpoint.saved": AgentEventType.SYSTEM_CHECKPOINT,
  "model.started": AgentEventType.CHAT_START,
  "model.delta": AgentEventType.CHAT_CHUNK,
  "model.completed": AgentEventType.CHAT_FINISH,
  "assistant.message": AgentEventType.CONTENT_MESSAGE,
  "plugin.before_model": AgentEventType.PLUGIN_HOOK,
  "plugin.after_model": AgentEventType.PLUGIN_HOOK,
  "tool.started": AgentEventType.TOOL_START,
  "tool.output": AgentEventType.TOOL_FINISH,
  "tool.error": AgentEventType.TOOL_ERROR,
};

export type AgentEvent = {
  ts: string;
  seq?: number;
} & (AgentEventData | CustomEventData);

export type CustomEventData = {
  type: string;
  data: Record<string, unknown>;
};

/**
 * Event data using OTel attribute naming conventions.
 * See: https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/
 */
export type AgentEventData =
  // Agent lifecycle
  | { type: AgentEventType.AGENT_INVOKED; data: Record<string, never> }
  | { type: AgentEventType.AGENT_STEP; data: { step: number } }
  | {
      type: AgentEventType.AGENT_PAUSED;
      data: { reason: "hitl" | "error" | "exhausted" | "subagent" };
    }
  | { type: AgentEventType.AGENT_RESUMED; data: Record<string, never> }
  | { type: AgentEventType.AGENT_COMPLETED; data: { result?: unknown } }
  | {
      type: AgentEventType.AGENT_ERROR;
      data: {
        "error.type": string;
        "error.message"?: string;
        "error.stack"?: string;
      };
    }
  | { type: AgentEventType.AGENT_CANCELED; data: Record<string, never> }

  // Model/chat calls - using OTel attribute names
  | {
      type: AgentEventType.CHAT_START;
      data: {
        "gen_ai.request.model": string;
      };
    }
  | {
      type: AgentEventType.CHAT_CHUNK;
      data: {
        "gen_ai.content.chunk": string;
      };
    }
  | {
      type: AgentEventType.CHAT_FINISH;
      data: {
        "gen_ai.usage.input_tokens"?: number;
        "gen_ai.usage.output_tokens"?: number;
        "gen_ai.response.model"?: string;
      };
    }

  // Tool execution - using OTel attribute names
  | {
      type: AgentEventType.TOOL_START;
      data: {
        "gen_ai.tool.name": string;
        "gen_ai.tool.call.id"?: string;
        "gen_ai.tool.arguments"?: unknown;
      };
    }
  | {
      type: AgentEventType.TOOL_FINISH;
      data: {
        "gen_ai.tool.name": string;
        "gen_ai.tool.call.id": string;
        "gen_ai.tool.response"?: unknown;
      };
    }
  | {
      type: AgentEventType.TOOL_ERROR;
      data: {
        "gen_ai.tool.name": string;
        "gen_ai.tool.call.id": string;
        "error.type": string;
        "error.message"?: string;
      };
    }

  // Content
  | {
      type: AgentEventType.CONTENT_MESSAGE;
      data: {
        "gen_ai.content.text"?: string;
        "gen_ai.content.tool_calls"?: Array<{
          id: string;
          name: string;
          arguments: unknown;
        }>;
      };
    }
  | {
      type: AgentEventType.USER_MESSAGE;
      data: {
        "gen_ai.content.messages": OTelMessage[];
      };
    }

  // System events
  | {
      type: AgentEventType.SYSTEM_THREAD_CREATED;
      data: { "gen_ai.conversation.id": string };
    }
  | {
      type: AgentEventType.SYSTEM_REQUEST_ACCEPTED;
      data: { idempotencyKey: string };
    }
  | {
      type: AgentEventType.SYSTEM_CHECKPOINT;
      data: { stateHash: string; size: number };
    }

  // Plugin hooks
  | {
      type: AgentEventType.PLUGIN_HOOK;
      data: { hook: "before_model" | "after_model"; pluginName: string };
    }

  // Inference operation details (OTel standard)
  // This is the key event for event sourcing - contains full input/output
  | {
      type: AgentEventType.INFERENCE_DETAILS;
      data: InferenceDetailsData;
    };

/**
 * Data payload for gen_ai.client.inference.operation.details event.
 * Following OTel GenAI semantic conventions.
 * See: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
 */
export type InferenceDetailsData = {
  // Required fields
  "gen_ai.operation.name": "chat" | "invoke_agent" | string;

  // Conditionally required
  "gen_ai.request.model"?: string;
  "gen_ai.conversation.id"?: string;

  // Input/output messages (opt-in, but required for event sourcing)
  "gen_ai.input.messages"?: OTelMessage[];
  "gen_ai.output.messages"?: OTelMessage[];

  // System instructions
  "gen_ai.system_instructions"?: SystemInstruction[];

  // Tool definitions
  "gen_ai.tool.definitions"?: ToolMeta[];

  // Usage metrics
  "gen_ai.usage.input_tokens"?: number;
  "gen_ai.usage.output_tokens"?: number;

  // Response metadata
  "gen_ai.response.model"?: string;
  "gen_ai.response.id"?: string;
  "gen_ai.response.finish_reasons"?: FinishReason[];

  // Error information (if operation failed)
  "error.type"?: string;
  "error.message"?: string;
};
