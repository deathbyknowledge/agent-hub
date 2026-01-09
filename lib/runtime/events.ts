export enum AgentEventType {
  THREAD_CREATED = "thread.created",
  REQUEST_ACCEPTED = "request.accepted",

  RUN_STARTED = "run.started",
  RUN_TICK = "run.tick",
  RUN_PAUSED = "run.paused",
  RUN_RESUMED = "run.resumed",
  RUN_CANCELED = "run.canceled",

  AGENT_STARTED = "agent.started",
  AGENT_COMPLETED = "agent.completed",
  AGENT_ERROR = "agent.error",

  CHECKPOINT_SAVED = "checkpoint.saved",

  MODEL_STARTED = "model.started",
  MODEL_DELTA = "model.delta",
  MODEL_COMPLETED = "model.completed",
  ASSISTANT_MESSAGE = "assistant.message",

  PLUGIN_BEFORE_MODEL = "plugin.before_model",
  PLUGIN_AFTER_MODEL = "plugin.after_model",

  TOOL_STARTED = "tool.started",
  TOOL_OUTPUT = "tool.output",
  TOOL_ERROR = "tool.error",
}

export type AgentEvent = {
  ts: string;
  seq?: number;
} & (AgentEventData | CustomEventData);

export type CustomEventData = {
  type: string;
  data: Record<string, unknown>;
};

export type AgentEventData =
  | { type: AgentEventType.THREAD_CREATED; data: { threadId: string } }
  | { type: AgentEventType.REQUEST_ACCEPTED; data: { idempotencyKey: string } }
  | { type: AgentEventType.RUN_STARTED; data: Record<string, never> }
  | { type: AgentEventType.RUN_TICK; data: { step: number } }
  | {
      type: AgentEventType.RUN_PAUSED;
      data: {
        reason: "hitl" | "error" | "exhausted" | "subagent";
      };
    }
  | { type: AgentEventType.RUN_RESUMED; data: Record<string, never> }
  | { type: AgentEventType.RUN_CANCELED; data: Record<string, never> }
  | { type: AgentEventType.AGENT_STARTED; data: Record<string, never> }
  | { type: AgentEventType.AGENT_COMPLETED; data: { result?: unknown } }
  | {
      type: AgentEventType.AGENT_ERROR;
      data: { error: string; stack?: string };
    }
  | {
      type: AgentEventType.CHECKPOINT_SAVED;
      data: { stateHash: string; size: number };
    }
  | { type: AgentEventType.MODEL_STARTED; data: { model: string } }
  | { type: AgentEventType.MODEL_DELTA; data: { delta: string } }
  | {
      type: AgentEventType.MODEL_COMPLETED;
      data: { usage?: { inputTokens: number; outputTokens: number } };
    }
  | {
      type: AgentEventType.ASSISTANT_MESSAGE;
      data: {
        content?: string;
        toolCalls?: Array<{ id: string; name: string; args: unknown }>;
      };
    }
  | {
      type: AgentEventType.PLUGIN_BEFORE_MODEL;
      data: { pluginName: string };
    }
  | {
      type: AgentEventType.PLUGIN_AFTER_MODEL;
      data: { pluginName: string };
    }
  | {
      type: AgentEventType.TOOL_STARTED;
      data: { toolName: string; args: unknown };
    }
  | {
      type: AgentEventType.TOOL_OUTPUT;
      data: { toolName: string; toolCallId: string; output: unknown };
    }
  | {
      type: AgentEventType.TOOL_ERROR;
      data: { toolName: string; toolCallId: string; error: string };
    };
