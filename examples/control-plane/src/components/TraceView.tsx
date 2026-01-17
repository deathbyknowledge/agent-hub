import { useState, useMemo, createContext, useContext } from "react";
import type { AgentEvent } from "agents-hub/client";
import { cn } from "../lib/utils";

// ============================================================================
// Types
// ============================================================================

interface ThreadMeta {
  id: string;
  agentType: string;
  createdAt: string;
}

interface TraceViewProps {
  events: AgentEvent[];
  threads?: ThreadMeta[];
  onEventClick?: (event: AgentEvent, label: string, type: string) => void;
  /** Fork the agent at this event's sequence number */
  onFork?: (event: AgentEvent) => void;
  /** Time-travel: callback when user selects a point in history */
  onTimeTravel?: (seq: number) => void;
  /** Currently selected time-travel position (null = live) */
  timeTravelSeq?: number | null;
}

// ============================================================================
// Filter System
// ============================================================================

type EventFilter = "model" | "tool" | "status" | "tick" | "context" | "input";

const FilterContext = createContext<Set<EventFilter>>(
  new Set(["model", "tool", "status", "context", "input"])
);

const FILTER_CONFIG: Record<
  EventFilter,
  { label: string; tag: string; events: string[] }
> = {
  input: {
    label: "INPUT",
    tag: "[USR]",
    events: ["gen_ai.content.user_message"],
  },
  model: {
    label: "MODEL",
    tag: "[MODEL]",
    events: ["gen_ai.chat.start", "gen_ai.chat.finish"],
  },
  tool: {
    label: "TOOLS",
    tag: "[TOOL]",
    events: ["gen_ai.tool.start", "gen_ai.tool.finish", "gen_ai.tool.error"],
  },
  status: {
    label: "STATUS",
    tag: "[SYS]",
    events: ["gen_ai.agent.invoked", "gen_ai.agent.paused", "gen_ai.agent.resumed", "gen_ai.agent.completed", "gen_ai.agent.error", "gen_ai.agent.canceled"],
  },
  context: {
    label: "CONTEXT",
    tag: "[CTX]",
    events: ["context.summarized"],
  },
  tick: {
    label: "TICKS",
    tag: "[TICK]",
    events: ["gen_ai.agent.step"],
  },
};

// ============================================================================
// Event Configuration
// ============================================================================

const EVENT_CONFIG: Record<
  string,
  {
    tag: string;
    color: string;
    label: string;
  }
> = {
  "gen_ai.content.user_message": {
    tag: "[USR]",
    color: "text-[#ffaa00]",
    label: "INPUT",
  },
  "gen_ai.agent.invoked": {
    tag: "[SYS]",
    color: "text-[#00aaff]",
    label: "START",
  },
  "gen_ai.agent.step": {
    tag: "[TICK]",
    color: "text-white/30",
    label: "TICK",
  },
  "gen_ai.agent.paused": {
    tag: "[SYS]",
    color: "text-[#ffaa00]",
    label: "PAUSED",
  },
  "gen_ai.agent.resumed": {
    tag: "[SYS]",
    color: "text-[#00aaff]",
    label: "RESUMED",
  },
  "gen_ai.agent.completed": {
    tag: "[SYS]",
    color: "text-[#00ff00]",
    label: "DONE",
  },
  "gen_ai.agent.error": {
    tag: "[SYS]",
    color: "text-[#ff0000]",
    label: "ERROR",
  },
  "gen_ai.agent.canceled": {
    tag: "[SYS]",
    color: "text-[#ffaa00]",
    label: "CANCELED",
  },
  "gen_ai.chat.start": {
    tag: "[MODEL]",
    color: "text-white/50",
    label: "MODEL",
  },
  "gen_ai.chat.finish": {
    tag: "[MODEL]",
    color: "text-white/50",
    label: "MODEL_DONE",
  },
  "gen_ai.tool.start": {
    tag: "[TOOL]",
    color: "text-[#00aaff]",
    label: "TOOL_START",
  },
  "gen_ai.tool.finish": {
    tag: "[TOOL]",
    color: "text-[#00ff00]",
    label: "TOOL",
  },
  "gen_ai.tool.error": {
    tag: "[TOOL]",
    color: "text-[#ff0000]",
    label: "TOOL_ERR",
  },
  "subagent.spawned": {
    tag: "[SUB]",
    color: "text-[#00aaff]",
    label: "SPAWN",
  },
  "subagent.completed": {
    tag: "[SUB]",
    color: "text-[#00aaff]",
    label: "RETURN",
  },
  "task.batch": {
    tag: "[TASK]",
    color: "text-[#00aaff]",
    label: "SUBAGENTS",
  },
  "context.summarized": {
    tag: "[CTX]",
    color: "text-amber-400/70",
    label: "SUMMARIZED",
  },
};

const DEFAULT_EVENT_CONFIG = {
  tag: "[EVT]",
  color: "text-white/40",
  label: "EVENT",
};

// ============================================================================
// Timeline Types
// ============================================================================

type TimelineItem =
  | { type: "event"; event: AgentEvent; children?: ChildAgent[] }
  | { type: "child"; childId: string; agentType: string; events: AgentEvent[] };

type ChildAgent = {
  childId: string;
  agentType: string;
  events: AgentEvent[];
};

type AgentStatus = "running" | "paused" | "done" | "error";

// Safe event types for forking - these represent stable state boundaries
const FORKABLE_EVENTS = new Set([
  "gen_ai.agent.invoked",        // Start of agent
  "gen_ai.agent.completed",      // Agent finished
  "gen_ai.agent.paused",         // Waiting for approval
  "gen_ai.tool.finish",          // Tool completed
  "gen_ai.tool.error",           // Tool errored
  "gen_ai.content.user_message", // User input
]);

function isForkableEvent(type: string): boolean {
  return FORKABLE_EVENTS.has(type);
}

// ============================================================================
// Utility Functions
// ============================================================================

function short(id: string): string {
  return (id || "").slice(0, 6);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getEventLabel(event: AgentEvent): string {
  const config = EVENT_CONFIG[event.type] || DEFAULT_EVENT_CONFIG;
  const data = event.data;

  // User input event
  if (event.type === "gen_ai.content.user_message" && data) {
    // Try to extract preview from OTel message format
    const messages = (data as { "gen_ai.content.messages"?: Array<{ parts?: Array<{ type: string; content?: string }> }> })["gen_ai.content.messages"];
    if (messages?.[0]?.parts?.[0]?.content) {
      const preview = messages[0].parts[0].content;
      return preview.length > 40 ? preview.slice(0, 40) + "..." : preview;
    }
    return "User Input";
  }

  // Agent lifecycle events
  if (event.type === "gen_ai.agent.invoked") {
    return "Agent Started";
  } else if (
    event.type === "gen_ai.agent.step" &&
    "step" in data &&
    typeof (data as any).step === "number"
  ) {
    return `Step ${(data as any).step}`;
  } else if (event.type === "gen_ai.agent.paused" && data && "reason" in data) {
    return `Paused: ${String(data.reason)}`;
  } else if (event.type === "gen_ai.agent.completed") {
    return "Completed";
  } else if (event.type === "gen_ai.agent.error" && data) {
    const msg = (data as any)["error.message"] || "Unknown error";
    return `Error: ${String(msg).slice(0, 30)}`;
  }

  // Model/chat events
  if (event.type === "gen_ai.chat.start" && data && "gen_ai.request.model" in data) {
    const model = String((data as any)["gen_ai.request.model"])
      .split("/")
      .pop()
      ?.slice(0, 20);
    return model || "Model";
  } else if (event.type === "gen_ai.chat.finish" && data) {
    const inputTokens = (data as any)["gen_ai.usage.input_tokens"] || 0;
    const outputTokens = (data as any)["gen_ai.usage.output_tokens"] || 0;
    if (inputTokens || outputTokens) {
      return `${inputTokens}/${outputTokens} tokens`;
    }
    return "Model Done";
  }

  // Tool events
  if (event.type === "gen_ai.tool.start" && data && "gen_ai.tool.name" in data) {
    return String((data as any)["gen_ai.tool.name"]);
  } else if (
    (event.type === "gen_ai.tool.finish" || event.type === "gen_ai.tool.error") &&
    data &&
    "gen_ai.tool.name" in data
  ) {
    return String((data as any)["gen_ai.tool.name"]);
  }

  // Subagent events
  if (event.type === "subagent.spawned" && data && "agentType" in data) {
    return `Spawned ${String(data.agentType)}`;
  } else if (event.type === "subagent.completed") {
    return "Child returned";
  } else if (event.type === "task.batch" && data && "count" in data) {
    const count = (data as { count: number }).count;
    return count === 1 ? "1 Subagent" : `${count} Subagents`;
  }

  // Context events
  if (event.type === "context.summarized" && data) {
    const d = data as { messagesSummarized?: number; memoriesExtracted?: number };
    const msgs = d.messagesSummarized || 0;
    const mems = d.memoriesExtracted || 0;
    return `Summarized ${msgs} msgs${mems > 0 ? `, ${mems} memories` : ""}`;
  }

  return config.label;
}

function eventPassesFilter(
  eventType: string,
  filters: Set<EventFilter>
): boolean {
  // Subagent/task events always show
  if (
    eventType === "subagent.spawned" ||
    eventType === "subagent.completed" ||
    eventType === "task.batch"
  ) {
    return true;
  }

  for (const [filter, config] of Object.entries(FILTER_CONFIG)) {
    if (config.events.includes(eventType)) {
      return filters.has(filter as EventFilter);
    }
  }
  return false;
}

// ============================================================================
// InlineAgentCard - Recursive component for agent timeline
// ============================================================================

function InlineAgentCard({
  threadId,
  agentType,
  events,
  status,
  duration,
  depth,
  onEventClick,
  onFork,
  eventsByThread,
  threadTypes,
}: {
  threadId: string;
  agentType: string;
  events: AgentEvent[];
  status: AgentStatus;
  duration?: number;
  depth: number;
  onEventClick?: (event: AgentEvent, label: string, type: string) => void;
  onFork?: (event: AgentEvent) => void;
  eventsByThread: Map<string, AgentEvent[]>;
  threadTypes: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const filters = useContext(FilterContext);

  const statusColors: Record<AgentStatus, string> = {
    running: "border-l-white/50",
    paused: "border-l-white/50",
    done: "border-l-white/30",
    error: "border-l-white/50",
  };

  const statusBadge: Record<AgentStatus, string> = {
    running: "border-[#00aaff] text-[#00aaff]",
    paused: "border-[#ffaa00] text-[#ffaa00]",
    done: "border-[#00ff00] text-[#00ff00]",
    error: "border-[#ff0000] text-[#ff0000]",
  };

  // Build timeline with children grouped into batches
  // A batch is all consecutive spawns before a gen_ai.agent.paused event
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    const spawnedChildren = new Set<string>();

    // Collect spawns into batches separated by gen_ai.agent.paused events
    // Each batch contains all spawns that occur before the next pause
    type Batch = { startIndex: number; children: ChildAgent[]; ts: string };
    const batches: Batch[] = [];
    let currentBatch: Batch | null = null;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      if (event.type === "subagent.spawned") {
        const data = event.data;
        const childId = data?.childThreadId as string;
        if (childId && !spawnedChildren.has(childId)) {
          spawnedChildren.add(childId);
          const childEvents = eventsByThread.get(childId) || [];
          const childType =
            threadTypes.get(childId) ||
            (data?.agentType as string) ||
            "Subagent";
          const child: ChildAgent = {
            childId,
            agentType: childType,
            events: childEvents,
          };

          if (!currentBatch) {
            currentBatch = { startIndex: i, children: [], ts: event.ts };
          }
          currentBatch.children.push(child);
        }
      } else if (event.type === "gen_ai.agent.paused" || event.type === "gen_ai.agent.resumed") {
        // End current batch when we hit a pause/resume
        if (currentBatch && currentBatch.children.length > 0) {
          batches.push(currentBatch);
        }
        currentBatch = null;
      }
    }
    // Don't forget the last batch if it exists
    if (currentBatch && currentBatch.children.length > 0) {
      batches.push(currentBatch);
    }

    // Build a map of startIndex -> batch for quick lookup
    const batchByStartIndex = new Map<number, Batch>();
    for (const batch of batches) {
      batchByStartIndex.set(batch.startIndex, batch);
    }

    // Track which batches we've rendered
    const renderedBatches = new Set<number>();

    // Second pass: build timeline
    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Skip subagent events - we show children in batches
      if (event.type === "subagent.completed") {
        continue;
      }

      if (event.type === "subagent.spawned") {
        // Check if this is the start of a batch
        const batch = batchByStartIndex.get(i);
        if (batch && !renderedBatches.has(i)) {
          renderedBatches.add(i);
          items.push({
            type: "event",
            event: {
              type: "task.batch",
              ts: batch.ts,
              data: { count: batch.children.length },
            } as AgentEvent,
            children: batch.children,
          });
        }
        continue;
      }

      if (!eventPassesFilter(event.type, filters)) {
        continue;
      }

      items.push({ type: "event", event });
    }

    return items;
  }, [events, eventsByThread, threadTypes, filters]);

  // Count all children (both standalone and nested under events)
  const childCount = timeline.reduce((count, item) => {
    if (item.type === "child") return count + 1;
    if (item.type === "event" && item.children) return count + item.children.length;
    return count;
  }, 0);

  return (
    <div
      className={cn(
        "border-l-2 bg-black",
        statusColors[status],
        depth > 0 && "ml-2"
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 transition-colors border-b border-white/10"
      >
        <span className="text-[10px] text-white/30 w-4">
          {expanded ? "[-]" : "[+]"}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-white truncate">
          {agentType}
        </span>
        <span className="text-[10px] text-white/30 font-mono hidden sm:inline">
          {short(threadId)}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[10px] flex-wrap">
          {duration !== undefined && (
            <span className="text-white/40 font-mono">
              {formatDuration(duration)}
            </span>
          )}
          {childCount > 0 && (
            <span className="text-[#00aaff]">{childCount}x SUB</span>
          )}
          <span
            className={cn(
              "px-1 py-0.5 border text-[10px] uppercase tracking-wider",
              statusBadge[status]
            )}
          >
            {status}
          </span>
        </div>
      </button>

      {/* Timeline */}
      {expanded && (
        <div className="px-2 pb-2">
          <div className="relative pl-4 border-l border-white/20 space-y-px">
            {timeline.map((item, idx) => {
              if (item.type === "event") {
                const event = item.event;
                const config = EVENT_CONFIG[event.type] || DEFAULT_EVENT_CONFIG;
                const label = getEventLabel(event);
                const children = item.children;

                return (
                  <div key={`${event.type}-${event.ts}-${idx}`}>
                    <div className="flex items-center gap-1 group">
                      <button
                        onClick={() => onEventClick?.(event, label, event.type)}
                        className="flex items-center gap-2 py-0.5 text-[11px] flex-1 text-left hover:bg-white/5 transition-colors"
                      >
                        <span className="text-[10px] text-white/30 font-mono w-16 shrink-0">
                          {formatTime(event.ts)}
                        </span>
                        <span
                          className={cn("text-[10px] w-14 shrink-0", config.color)}
                        >
                          {config.tag}
                        </span>
                        <span className="flex-1 truncate text-white/70 uppercase">
                          {label}
                        </span>
                        {children && children.length > 0 && (
                          <span className="text-[10px] text-[#00aaff]">
                            {children.length}x SUB
                          </span>
                        )}
                      </button>
                      {onFork && event.seq !== undefined && isForkableEvent(event.type) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onFork(event);
                          }}
                          className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/30 hover:text-white hover:bg-white/10 border border-white/10 hover:border-white/40 transition-all shrink-0"
                          title={`Fork at event #${event.seq}`}
                        >
                          Fork
                        </button>
                      )}
                    </div>
                    {/* Nested children under this tool call */}
                    {children && children.length > 0 && (
                      <div className="ml-4 mt-1 space-y-1">
                        {children.map((child) => {
                          const childEvents = child.events;
                          let childStatus: AgentStatus = "running";
                          for (const ev of childEvents) {
                            if (ev.type === "gen_ai.agent.completed") childStatus = "done";
                            else if (ev.type === "gen_ai.agent.error") childStatus = "error";
                            else if (ev.type === "gen_ai.agent.paused" && childStatus === "running")
                              childStatus = "paused";
                            else if (ev.type === "gen_ai.agent.resumed" && childStatus === "paused")
                              childStatus = "running";
                          }

                          let childDuration: number | undefined;
                          if (childEvents.length > 0) {
                            const start = new Date(childEvents[0].ts || 0).getTime();
                            const end = new Date(childEvents[childEvents.length - 1].ts || 0).getTime();
                            childDuration = end - start;
                          }

                          return (
                            <InlineAgentCard
                              key={child.childId}
                              threadId={child.childId}
                              agentType={child.agentType}
                              events={childEvents}
                              status={childStatus}
                              duration={childDuration}
                              depth={depth + 1}
                              onEventClick={onEventClick}
                              onFork={onFork}
                              eventsByThread={eventsByThread}
                              threadTypes={threadTypes}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              } else {
              // Standalone child agent (no toolCallId match) - render inline recursively
              const childEvents = item.events;
              let childStatus: AgentStatus = "running";
              for (const ev of childEvents) {
                if (ev.type === "gen_ai.agent.completed") childStatus = "done";
                else if (ev.type === "gen_ai.agent.error") childStatus = "error";
                else if (
                  ev.type === "gen_ai.agent.paused" &&
                  childStatus === "running"
                )
                  childStatus = "paused";
                else if (
                  ev.type === "gen_ai.agent.resumed" &&
                  childStatus === "paused"
                )
                  childStatus = "running";
              }

                let childDuration: number | undefined;
                if (childEvents.length > 0) {
                  const start = new Date(childEvents[0].ts || 0).getTime();
                  const end = new Date(
                    childEvents[childEvents.length - 1].ts || 0
                  ).getTime();
                  childDuration = end - start;
                }

                return (
                  <div key={item.childId} className="py-1">
                    <InlineAgentCard
                      threadId={item.childId}
                      agentType={item.agentType}
                      events={childEvents}
                      status={childStatus}
                      duration={childDuration}
                      depth={depth + 1}
                      onEventClick={onEventClick}
                      onFork={onFork}
                      eventsByThread={eventsByThread}
                      threadTypes={threadTypes}
                    />
                  </div>
                );
              }
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Filter Toggle Button
// ============================================================================

function FilterButton({
  filter,
  enabled,
  onToggle,
}: {
  filter: EventFilter;
  enabled: boolean;
  onToggle: () => void;
}) {
  const config = FILTER_CONFIG[filter];
  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-wider transition-all border",
        enabled
          ? "bg-white text-black border-white"
          : "bg-transparent text-white/40 border-white/20 hover:text-white hover:border-white/50"
      )}
    >
      <span>{config.tag}</span>
      <span>{config.label}</span>
    </button>
  );
}

// ============================================================================
// Main TraceView Component
// ============================================================================

export function TraceView({
  events,
  threads = [],
  onEventClick,
  onFork,
  onTimeTravel,
  timeTravelSeq,
}: TraceViewProps) {
  const [enabledFilters, setEnabledFilters] = useState<Set<EventFilter>>(
    new Set(["input", "model", "tool", "status"])
  );

  const toggleFilter = (filter: EventFilter) => {
    setEnabledFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  // Process events into structured data
  const { rootAgents, eventsByThread, threadTypes, stats } = useMemo(() => {
    const eventsByThread = new Map<string, AgentEvent[]>();
    const childToParent = new Map<string, string>();
    const threadTypes = new Map<string, string>();

    // Group events by thread
    for (const event of events) {
      const threadId = (event as { threadId?: string }).threadId || "unknown";

      if (!eventsByThread.has(threadId)) {
        eventsByThread.set(threadId, []);
      }
      eventsByThread.get(threadId)!.push(event);

      // Track parent-child relationships
      if (event.type === "subagent.spawned") {
        const data = event.data;
        const childId = data?.childThreadId as string;
        const agentType = data?.agentType as string;
        if (childId) {
          childToParent.set(childId, threadId);
          if (agentType) {
            threadTypes.set(childId, agentType);
          }
        }
      }
    }

    // Sort events within each thread by timestamp to ensure correct ordering
    // When timestamps are equal, put subagent.spawned events first so all spawns
    // in a batch are grouped together before the gen_ai.agent.paused event
    for (const [, threadEvents] of eventsByThread) {
      threadEvents.sort((a, b) => {
        const timeA = new Date(a.ts || 0).getTime();
        const timeB = new Date(b.ts || 0).getTime();
        if (timeA !== timeB) return timeA - timeB;
        // Same timestamp: spawns come first
        const aIsSpawn = a.type === "subagent.spawned" ? 0 : 1;
        const bIsSpawn = b.type === "subagent.spawned" ? 0 : 1;
        return aIsSpawn - bIsSpawn;
      });
    }

    // Get thread types from threads prop
    for (const thread of threads) {
      if (thread.agentType && !threadTypes.has(thread.id)) {
        threadTypes.set(thread.id, thread.agentType);
      }
    }

    // Find root threads (not children of any other thread)
    const rootThreadIds: string[] = [];
    for (const threadId of eventsByThread.keys()) {
      if (!childToParent.has(threadId)) {
        rootThreadIds.push(threadId);
      }
    }

    // Build root agent data
    const rootAgents = rootThreadIds.map((threadId) => {
      const threadEvents = eventsByThread.get(threadId) || [];

      let status: AgentStatus = "running";
      for (const ev of threadEvents) {
        if (ev.type === "gen_ai.agent.completed") status = "done";
        else if (ev.type === "gen_ai.agent.error") status = "error";
        else if (ev.type === "gen_ai.agent.paused" && status === "running")
          status = "paused";
        else if (ev.type === "gen_ai.agent.resumed" && status === "paused")
          status = "running";
      }

      let duration: number | undefined;
      if (threadEvents.length > 0) {
        const start = new Date(threadEvents[0].ts || 0).getTime();
        const end = new Date(
          threadEvents[threadEvents.length - 1].ts || 0
        ).getTime();
        duration = end - start;
      }

      return {
        threadId,
        agentType: threadTypes.get(threadId) || "Agent",
        status,
        events: threadEvents,
        duration,
      };
    });

    // Calculate stats
    let totalAgents = 0;
    const totalEvents = events.length;
    let completed = 0;
    let errors = 0;

    const countedThreads = new Set<string>();
    for (const threadId of eventsByThread.keys()) {
      if (!countedThreads.has(threadId)) {
        countedThreads.add(threadId);
        totalAgents++;
        const threadEvents = eventsByThread.get(threadId) || [];
        const hasCompleted = threadEvents.some(
          (e) => e.type === "gen_ai.agent.completed"
        );
        const hasError = threadEvents.some((e) => e.type === "gen_ai.agent.error");
        if (hasCompleted) completed++;
        if (hasError) errors++;
      }
    }

    return {
      rootAgents,
      eventsByThread,
      threadTypes,
      stats: { totalAgents, totalEvents, completed, errors },
    };
  }, [events, threads]);

  if (events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-black">
        <div className="text-center border border-white/20 p-6">
          <div className="text-white/20 text-2xl mb-3 font-mono">○</div>
          <p className="text-[10px] uppercase tracking-widest text-white/40">
            NO EVENTS RECORDED
          </p>
          <p className="text-[10px] uppercase tracking-wider text-white/20 mt-2">
            INITIATE CONVERSATION TO BEGIN TRACE
          </p>
        </div>
      </div>
    );
  }

  return (
    <FilterContext.Provider value={enabledFilters}>
      <div className="h-full flex flex-col bg-black">
        {/* Stats bar */}
        <div className="px-3 py-2 border-b-2 border-white bg-black">
          <div className="flex items-center gap-4 text-[10px] uppercase tracking-wider flex-wrap">
            <div className="flex items-center gap-1.5 text-white/50">
              <span className="text-[#00ff00]">▶</span>
              <span>{stats.totalAgents} AGENTS</span>
            </div>
            <div className="flex items-center gap-1.5 text-white/50">
              <span>{stats.totalEvents} EVENTS</span>
            </div>
            {stats.completed > 0 && (
              <div className="text-[#00ff00]">{stats.completed} OK</div>
            )}
            {stats.errors > 0 && (
              <div className="text-[#ff0000]">{stats.errors} ERR</div>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-3 py-2 border-b border-white/30 flex items-center gap-2 flex-wrap bg-black">
          <span className="text-[10px] uppercase tracking-wider text-white/30 mr-1 hidden sm:inline">
            FILTER:
          </span>
          {(Object.keys(FILTER_CONFIG) as EventFilter[]).map((filter) => (
            <FilterButton
              key={filter}
              filter={filter}
              enabled={enabledFilters.has(filter)}
              onToggle={() => toggleFilter(filter)}
            />
          ))}
        </div>

        {/* Time-travel slider */}
        {onTimeTravel && events.length > 0 && (() => {
          const maxSeq = Math.max(...events.map((e) => e.seq ?? 0));
          const minSeq = Math.min(...events.filter((e) => e.seq !== undefined).map((e) => e.seq!));
          const currentSeq = timeTravelSeq ?? maxSeq;
          const isLive = timeTravelSeq === null || timeTravelSeq === undefined;
          
          return (
            <div className="px-3 py-2 border-b border-white/20 bg-black/50 flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-wider text-white/30 shrink-0">
                TIME:
              </span>
              <input
                type="range"
                min={minSeq}
                max={maxSeq}
                value={currentSeq}
                onChange={(e) => onTimeTravel(parseInt(e.target.value, 10))}
                className="flex-1 h-1 bg-white/20 appearance-none cursor-pointer accent-white"
                style={{ accentColor: isLive ? "#00ff00" : "#ffaa00" }}
              />
              <span className={cn(
                "text-[10px] font-mono w-20 text-right",
                isLive ? "text-[#00ff00]" : "text-[#ffaa00]"
              )}>
                {isLive ? "LIVE" : `@${currentSeq}`}
              </span>
              {!isLive && (
                <button
                  onClick={() => onTimeTravel(maxSeq)}
                  className="px-2 py-0.5 text-[9px] uppercase tracking-wider text-[#00ff00] border border-[#00ff00]/50 hover:bg-[#00ff00]/10 transition-colors"
                >
                  Go Live
                </button>
              )}
            </div>
          );
        })()}

        {/* Timeline content */}
        <div className="flex-1 overflow-auto p-3 bg-black">
          <div className="space-y-2">
            {rootAgents.map((agent) => (
              <InlineAgentCard
                key={agent.threadId}
                threadId={agent.threadId}
                agentType={agent.agentType}
                events={agent.events}
                status={agent.status}
                duration={agent.duration}
                depth={0}
                onEventClick={onEventClick}
                onFork={onFork}
                eventsByThread={eventsByThread}
                threadTypes={threadTypes}
              />
            ))}
          </div>
        </div>
      </div>
    </FilterContext.Provider>
  );
}

export type { AgentEvent, ThreadMeta, TraceViewProps };
