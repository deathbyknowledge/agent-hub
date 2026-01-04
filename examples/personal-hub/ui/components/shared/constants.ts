/**
 * Shared constants for styling and configuration
 */
import type { AgentStatus } from "./types";

// Status colors (background)
export const STATUS_BG_COLORS: Record<AgentStatus, string> = {
  running: "bg-[#00aaff]",
  paused: "bg-[#ffaa00]",
  done: "bg-[#00ff00]",
  error: "bg-[#ff0000]",
  idle: "bg-white/30",
};

// Status colors (text)
export const STATUS_TEXT_COLORS: Record<AgentStatus, string> = {
  running: "text-[#00aaff]",
  paused: "text-[#ffaa00]",
  done: "text-[#00ff00]",
  error: "text-[#ff0000]",
  idle: "text-white/50",
};

// Status colors (border)
export const STATUS_BORDER_COLORS: Record<AgentStatus, string> = {
  running: "border-[#00aaff]",
  paused: "border-[#ffaa00]",
  done: "border-[#00ff00]",
  error: "border-[#ff0000]",
  idle: "border-white/30",
};

// Status labels with colors for ContentHeader
export const STATUS_LABELS: Record<AgentStatus, { label: string; color: string; borderColor: string }> = {
  running: { label: "RUNNING", color: "text-[#00aaff]", borderColor: "border-[#00aaff]" },
  paused: { label: "PAUSED", color: "text-[#ffaa00]", borderColor: "border-[#ffaa00]" },
  done: { label: "COMPLETE", color: "text-[#00ff00]", borderColor: "border-[#00ff00]" },
  error: { label: "ERROR", color: "text-[#ff0000]", borderColor: "border-[#ff0000]" },
  idle: { label: "IDLE", color: "text-white/50", borderColor: "border-white/30" },
};

// Event filter types for TraceView
export type EventFilter = "model" | "tool" | "status" | "tick" | "context";

// Filter configuration for TraceView
export const FILTER_CONFIG: Record<EventFilter, { label: string; tag: string; events: string[] }> = {
  model: {
    label: "MODEL",
    tag: "[MODEL]",
    events: ["model.started"],
  },
  tool: {
    label: "TOOLS",
    tag: "[TOOL]",
    events: ["tool.output", "tool.error"],
  },
  status: {
    label: "STATUS",
    tag: "[SYS]",
    events: ["run.paused", "run.resumed", "agent.completed", "agent.error"],
  },
  context: {
    label: "CONTEXT",
    tag: "[CTX]",
    events: ["context.summarized"],
  },
  tick: {
    label: "TICKS",
    tag: "[TICK]",
    events: ["run.tick"],
  },
};

// Event configuration for TraceView
export const EVENT_CONFIG: Record<string, { tag: string; color: string; label: string }> = {
  "run.tick": { tag: "[TICK]", color: "text-white/30", label: "TICK" },
  "model.started": { tag: "[MODEL]", color: "text-white/50", label: "MODEL" },
  "tool.output": { tag: "[TOOL]", color: "text-[#00ff00]", label: "TOOL" },
  "tool.error": { tag: "[TOOL]", color: "text-[#ff0000]", label: "TOOL_ERR" },
  "run.paused": { tag: "[SYS]", color: "text-[#ffaa00]", label: "PAUSED" },
  "run.resumed": { tag: "[SYS]", color: "text-[#00aaff]", label: "RESUMED" },
  "agent.completed": { tag: "[SYS]", color: "text-[#00ff00]", label: "DONE" },
  "agent.error": { tag: "[SYS]", color: "text-[#ff0000]", label: "ERROR" },
  "subagent.spawned": { tag: "[SUB]", color: "text-[#00aaff]", label: "SPAWN" },
  "subagent.completed": { tag: "[SUB]", color: "text-[#00aaff]", label: "RETURN" },
  "task.batch": { tag: "[TASK]", color: "text-[#00aaff]", label: "SUBAGENTS" },
  "context.summarized": { tag: "[CTX]", color: "text-amber-400/70", label: "SUMMARIZED" },
};

export const DEFAULT_EVENT_CONFIG = {
  tag: "[EVT]",
  color: "text-white/40",
  label: "EVENT",
};

// Tab configuration for agent views
export const AGENT_TABS = [
  { id: "chat" as const, label: "CHAT", icon: "[>]" },
  { id: "trace" as const, label: "TRACE", icon: "[~]" },
  { id: "files" as const, label: "FILES", icon: "[/]" },
  { id: "todos" as const, label: "TASKS", icon: "[*]" },
];
