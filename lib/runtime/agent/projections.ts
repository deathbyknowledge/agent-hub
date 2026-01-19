/**
 * Event projections for deriving agent state from events.
 * 
 * This module implements event sourcing by providing functions to replay events
 * and reconstruct agent state. The projection is the "read model" derived from
 * the event log (the "write model").
 * 
 * Key concepts:
 * - Events are the source of truth
 * - State is derived by folding events through a reducer
 * - Projections can be computed up to any point in time (time-travel)
 * - Snapshots can be used to optimize replay performance
 */

import type { AgentEvent, InferenceDetailsData } from "../events";
import { AgentEventType } from "../events";
import type { OTelMessage, RunStatus, ToolCall } from "../types";
import { fromOTelMessages, extractToolCalls } from "../messages";

/**
 * The projected state of an agent, derived from events.
 * This represents the complete state that can be reconstructed from events.
 */
export type AgentProjection = {
  /** Messages in the conversation (derived from INFERENCE_DETAILS events) */
  messages: OTelMessage[];
  /** Current run status */
  status: RunStatus;
  /** Current step number */
  step: number;
  /** Pending tool calls awaiting execution */
  pendingToolCalls: ToolCall[];
  /** Agent variables (not currently tracked in events - for future use) */
  vars: Record<string, unknown>;
  /** Total input tokens used */
  totalInputTokens: number;
  /** Total output tokens used */
  totalOutputTokens: number;
  /** Number of inference calls made */
  inferenceCount: number;
  /** Last error if any */
  lastError?: { type: string; message?: string };
};

/**
 * Initial state for a new projection.
 */
export const initialProjection: AgentProjection = {
  messages: [],
  status: "registered",
  step: 0,
  pendingToolCalls: [],
  vars: {},
  totalInputTokens: 0,
  totalOutputTokens: 0,
  inferenceCount: 0,
};

/**
 * Apply a single event to the projection state.
 * This is a pure function - no side effects.
 */
export function applyEvent(
  state: AgentProjection,
  event: AgentEvent
): AgentProjection {
  switch (event.type) {
    // Agent lifecycle events
    case AgentEventType.AGENT_INVOKED:
      return { ...state, status: "running" };

    case AgentEventType.AGENT_STEP:
      return { ...state, step: (event.data as { step: number }).step };

    case AgentEventType.AGENT_PAUSED:
      return { ...state, status: "paused" };

    case AgentEventType.AGENT_RESUMED:
      return { ...state, status: "running" };

    case AgentEventType.AGENT_COMPLETED:
      return { ...state, status: "completed", pendingToolCalls: [] };

    case AgentEventType.AGENT_ERROR: {
      const errorData = event.data as {
        "error.type": string;
        "error.message"?: string;
      };
      return {
        ...state,
        status: "error",
        lastError: {
          type: errorData["error.type"],
          message: errorData["error.message"],
        },
      };
    }

    case AgentEventType.AGENT_CANCELED:
      return { ...state, status: "canceled", pendingToolCalls: [] };

    // User input messages (from invoke)
    case AgentEventType.USER_MESSAGE: {
      const data = event.data as { "gen_ai.content.messages": OTelMessage[] };
      const userMessages = data["gen_ai.content.messages"] ?? [];
      return {
        ...state,
        messages: [...state.messages, ...userMessages],
      };
    }

    // Inference details - captures model output
    // NOTE: User messages come from USER_MESSAGE event, tool results from TOOL_* events
    case AgentEventType.INFERENCE_DETAILS: {
      const data = event.data as InferenceDetailsData;
      const outputMessages = data["gen_ai.output.messages"] ?? [];

      // Extract pending tool calls from output messages
      const pendingToolCalls: ToolCall[] = [];
      for (const msg of outputMessages) {
        if (msg.role === "assistant") {
          pendingToolCalls.push(...extractToolCalls(msg.parts));
        }
      }

      return {
        ...state,
        // Append output messages (assistant response)
        messages: [...state.messages, ...outputMessages],
        pendingToolCalls,
        // Update token counts
        totalInputTokens:
          state.totalInputTokens + (data["gen_ai.usage.input_tokens"] ?? 0),
        totalOutputTokens:
          state.totalOutputTokens + (data["gen_ai.usage.output_tokens"] ?? 0),
        inferenceCount: state.inferenceCount + 1,
      };
    }

    // Tool events - track tool execution results
    case AgentEventType.TOOL_FINISH: {
      const toolData = event.data as {
        "gen_ai.tool.name": string;
        "gen_ai.tool.call.id": string;
        "gen_ai.tool.response"?: unknown;
      };

      // Remove completed tool from pending
      const pendingToolCalls = state.pendingToolCalls.filter(
        (tc) => tc.id !== toolData["gen_ai.tool.call.id"]
      );

      // Add tool result message
      const toolMessage: OTelMessage = {
        role: "tool",
        parts: [
          {
            type: "tool_call_response",
            id: toolData["gen_ai.tool.call.id"],
            response: toolData["gen_ai.tool.response"],
          },
        ],
      };

      return {
        ...state,
        messages: [...state.messages, toolMessage],
        pendingToolCalls,
      };
    }

    case AgentEventType.TOOL_ERROR: {
      const toolData = event.data as {
        "gen_ai.tool.name": string;
        "gen_ai.tool.call.id": string;
        "error.type": string;
        "error.message"?: string;
      };

      // Remove errored tool from pending
      const pendingToolCalls = state.pendingToolCalls.filter(
        (tc) => tc.id !== toolData["gen_ai.tool.call.id"]
      );

      // Add error result as tool message
      const errorMessage: OTelMessage = {
        role: "tool",
        parts: [
          {
            type: "tool_call_response",
            id: toolData["gen_ai.tool.call.id"],
            response: `Error: ${toolData["error.message"] ?? toolData["error.type"]}`,
          },
        ],
      };

      return {
        ...state,
        messages: [...state.messages, errorMessage],
        pendingToolCalls,
      };
    }

    // Ignore other events - they don't affect projection state.
    // Note: Plugins can emit custom events (e.g., "gen_ai.context.summarized")
    // which are stored but not processed here. Plugins read their own events directly.
    default:
      return state;
  }
}

/**
 * Project events into agent state by folding all events through the reducer.
 * 
 * @param events - Array of events to replay
 * @param initialState - Optional initial state (useful with snapshots)
 * @returns The projected state after all events
 */
export function projectEvents(
  events: AgentEvent[],
  initialState: AgentProjection = initialProjection
): AgentProjection {
  return events.reduce(applyEvent, initialState);
}

/**
 * Project events up to a specific sequence number (for time-travel).
 * 
 * @param events - Array of events to replay
 * @param untilSeq - Stop at this sequence number (inclusive)
 * @param initialState - Optional initial state
 * @returns The projected state at the given point in time
 */
export function projectEventsUntil(
  events: AgentEvent[],
  untilSeq: number,
  initialState: AgentProjection = initialProjection
): AgentProjection {
  const relevantEvents = events.filter((e) => (e.seq ?? 0) <= untilSeq);
  return projectEvents(relevantEvents, initialState);
}

/**
 * Project events starting from a snapshot.
 * This is an optimization for long event logs.
 * 
 * @param snapshot - Previous projection state
 * @param snapshotSeq - Sequence number of the snapshot
 * @param events - All events (will filter to those after snapshot)
 * @returns The projected state
 */
export function projectFromSnapshot(
  snapshot: AgentProjection,
  snapshotSeq: number,
  events: AgentEvent[]
): AgentProjection {
  const newEvents = events.filter((e) => (e.seq ?? 0) > snapshotSeq);
  return projectEvents(newEvents, snapshot);
}

/**
 * Get messages in legacy format (for backward compatibility).
 */
export function getMessagesLegacy(projection: AgentProjection) {
  return fromOTelMessages(projection.messages);
}

/**
 * Check if projection needs a new snapshot.
 * Snapshots should be created periodically to avoid replaying too many events.
 */
export function shouldSnapshot(
  eventsSinceLastSnapshot: number,
  threshold = 100
): boolean {
  return eventsSinceLastSnapshot >= threshold;
}

/**
 * Snapshot type for persisting projection state.
 */
export type ProjectionSnapshot = {
  /** Sequence number of the last event included in this snapshot */
  lastEventSeq: number;
  /** The projected state at this point */
  state: AgentProjection;
  /** ISO timestamp when snapshot was created */
  createdAt: string;
};

/**
 * Create a snapshot from current projection state.
 */
export function createSnapshot(
  state: AgentProjection,
  lastEventSeq: number
): ProjectionSnapshot {
  return {
    lastEventSeq,
    state,
    createdAt: new Date().toISOString(),
  };
}
