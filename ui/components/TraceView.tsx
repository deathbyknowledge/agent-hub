import { useState, useMemo, createContext, useContext } from "react";
import { cn } from "../lib/utils";
import {
  CaretRight,
  CaretDown,
  Check,
  Clock,
  Wrench,
  Robot,
  Play,
  Pause,
  XCircle,
  Brain,
  ArrowRight,
  ArrowLeft,
} from "@phosphor-icons/react";

// ============================================================================
// Types
// ============================================================================

interface AgentEvent {
  type: string;
  threadId: string;
  ts: string;
  seq?: number;
  data?: Record<string, unknown>;
}

interface ThreadMeta {
  id: string;
  agentType: string;
  createdAt: string;
}

interface TraceViewProps {
  events: AgentEvent[];
  threads?: ThreadMeta[];
  onEventClick?: (event: AgentEvent, label: string, type: string) => void;
}

// ============================================================================
// Filter System
// ============================================================================

type EventFilter = "model" | "tool" | "status" | "tick";

const FilterContext = createContext<Set<EventFilter>>(
  new Set(["model", "tool", "status"])
);

const FILTER_CONFIG: Record<
  EventFilter,
  { label: string; icon: React.ReactNode; events: string[] }
> = {
  model: {
    label: "Model",
    icon: <Brain size={12} />,
    events: ["model.started"],
  },
  tool: {
    label: "Tools",
    icon: <Wrench size={12} />,
    events: ["tool.output", "tool.error"],
  },
  status: {
    label: "Status",
    icon: <Check size={12} />,
    events: ["run.paused", "run.resumed", "agent.completed", "agent.error"],
  },
  tick: {
    label: "Ticks",
    icon: <Play size={12} />,
    events: ["run.tick"],
  },
};

// ============================================================================
// Event Configuration
// ============================================================================

const EVENT_CONFIG: Record<
  string,
  {
    icon: React.ReactNode;
    color: string;
    bg: string;
    dotColor: string;
    label: string;
  }
> = {
  "run.tick": {
    icon: <Play size={10} />,
    color: "text-white/40",
    bg: "bg-white/5",
    dotColor: "bg-white/30",
    label: "TICK",
  },
  "model.started": {
    icon: <Brain size={10} />,
    color: "text-[#00ff00]",
    bg: "bg-[#00ff00]/10",
    dotColor: "bg-[#00ff00]",
    label: "MODEL",
  },
  "tool.output": {
    icon: <Wrench size={10} />,
    color: "text-[#ffaa00]",
    bg: "bg-[#ffaa00]/10",
    dotColor: "bg-[#ffaa00]",
    label: "TOOL",
  },
  "tool.error": {
    icon: <XCircle size={10} />,
    color: "text-[#ff0000]",
    bg: "bg-[#ff0000]/10",
    dotColor: "bg-[#ff0000]",
    label: "TOOL_ERR",
  },
  "run.paused": {
    icon: <Pause size={10} />,
    color: "text-[#ffaa00]",
    bg: "bg-[#ffaa00]/10",
    dotColor: "bg-[#ffaa00]",
    label: "PAUSED",
  },
  "run.resumed": {
    icon: <Play size={10} />,
    color: "text-[#00aaff]",
    bg: "bg-[#00aaff]/10",
    dotColor: "bg-[#00aaff]",
    label: "RESUMED",
  },
  "agent.completed": {
    icon: <Check size={10} />,
    color: "text-[#00ff00]",
    bg: "bg-[#00ff00]/10",
    dotColor: "bg-[#00ff00]",
    label: "COMPLETE",
  },
  "agent.error": {
    icon: <XCircle size={10} />,
    color: "text-[#ff0000]",
    bg: "bg-[#ff0000]/10",
    dotColor: "bg-[#ff0000]",
    label: "ERROR",
  },
  "subagent.spawned": {
    icon: <ArrowRight size={10} />,
    color: "text-[#00aaff]",
    bg: "bg-[#00aaff]/10",
    dotColor: "bg-[#00aaff]",
    label: "SPAWN",
  },
  "subagent.completed": {
    icon: <ArrowLeft size={10} />,
    color: "text-[#00aaff]",
    bg: "bg-[#00aaff]/10",
    dotColor: "bg-[#00aaff]",
    label: "RETURNED",
  },
};

const DEFAULT_EVENT_CONFIG = {
  icon: <Play size={10} />,
  color: "text-white/40",
  bg: "bg-white/5",
  dotColor: "bg-white/30",
  label: "EVENT",
};

// ============================================================================
// Timeline Types
// ============================================================================

type TimelineItem =
  | { type: "event"; event: AgentEvent }
  | { type: "child"; childId: string; agentType: string; events: AgentEvent[] };

type AgentStatus = "running" | "paused" | "done" | "error";

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

  if (event.type === "run.tick" && data?.step) {
    return `Step ${data.step}`;
  } else if (event.type === "model.started" && data?.model) {
    const model = String(data.model).split("/").pop()?.slice(0, 20);
    return model || "Model";
  } else if (
    (event.type === "tool.output" || event.type === "tool.error") &&
    data?.toolName
  ) {
    return String(data.toolName);
  } else if (event.type === "run.paused" && data?.reason) {
    return `Paused: ${data.reason}`;
  } else if (event.type === "subagent.spawned" && data?.agentType) {
    return `Spawned ${data.agentType}`;
  } else if (event.type === "subagent.completed") {
    return "Child returned";
  }
  return config.label;
}

function eventPassesFilter(
  eventType: string,
  filters: Set<EventFilter>
): boolean {
  // Subagent events always show
  if (eventType === "subagent.spawned" || eventType === "subagent.completed") {
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
  eventsByThread: Map<string, AgentEvent[]>;
  threadTypes: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState(true);
  const filters = useContext(FilterContext);

  const statusColors: Record<AgentStatus, string> = {
    running: "border-l-[#00aaff]",
    paused: "border-l-[#ffaa00]",
    done: "border-l-[#00ff00]",
    error: "border-l-[#ff0000]",
  };

  const statusBadge: Record<AgentStatus, string> = {
    running: "border-[#00aaff] text-[#00aaff]",
    paused: "border-[#ffaa00] text-[#ffaa00]",
    done: "border-[#00ff00] text-[#00ff00]",
    error: "border-[#ff0000] text-[#ff0000]",
  };

  // Build timeline with inline children
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    const spawnedChildren = new Set<string>();
    const pendingChildren: {
      childId: string;
      agentType: string;
      events: AgentEvent[];
    }[] = [];

    for (const event of events) {
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
          pendingChildren.push({
            childId,
            agentType: childType,
            events: childEvents,
          });
        }
      } else if (event.type !== "subagent.completed") {
        if (eventPassesFilter(event.type, filters)) {
          items.push({ type: "event", event });
        }

        // Add pending children after paused event
        if (pendingChildren.length > 0 && event.type === "run.paused") {
          for (const child of pendingChildren) {
            items.push({
              type: "child",
              childId: child.childId,
              agentType: child.agentType,
              events: child.events,
            });
          }
          pendingChildren.length = 0;
        }
      }
    }

    // Add remaining pending children
    for (const child of pendingChildren) {
      items.push({
        type: "child",
        childId: child.childId,
        agentType: child.agentType,
        events: child.events,
      });
    }

    return items;
  }, [events, eventsByThread, threadTypes, filters]);

  const childCount = timeline.filter((t) => t.type === "child").length;

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
        {expanded ? (
          <CaretDown size={10} className="text-white/40 shrink-0" />
        ) : (
          <CaretRight size={10} className="text-white/40 shrink-0" />
        )}
        <span className="text-[10px] text-[#00ff00]">▶</span>
        <span className="text-[11px] uppercase tracking-wider text-white truncate">
          {agentType}
        </span>
        <span className="text-[10px] text-white/30 font-mono hidden sm:inline">
          [{short(threadId)}]
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[10px] flex-wrap">
          {duration !== undefined && (
            <span className="text-white/40 font-mono flex items-center gap-1">
              <Clock size={10} />
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

                return (
                  <div
                    key={`${event.type}-${event.ts}-${idx}`}
                    className="relative"
                  >
                    {/* Timeline dot */}
                    <div
                      className={cn(
                        "absolute -left-[17px] top-1.5 w-2 h-2",
                        config.dotColor
                      )}
                    />
                    <button
                      onClick={() => onEventClick?.(event, label, event.type)}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1 text-[11px] w-full text-left",
                        "hover:bg-white/5 transition-colors border-l border-transparent hover:border-white/30",
                        config.bg
                      )}
                    >
                      <span className={config.color}>{config.icon}</span>
                      <span className="flex-1 truncate text-white/70 uppercase tracking-wider">
                        {label}
                      </span>
                      <span className="text-[10px] text-white/30 font-mono">
                        {formatTime(event.ts)}
                      </span>
                    </button>
                  </div>
                );
              } else {
                // Child agent - render inline recursively
                const childEvents = item.events;
                let childStatus: AgentStatus = "running";
                for (const ev of childEvents) {
                  if (ev.type === "agent.completed") childStatus = "done";
                  else if (ev.type === "agent.error") childStatus = "error";
                  else if (
                    ev.type === "run.paused" &&
                    childStatus === "running"
                  )
                    childStatus = "paused";
                  else if (
                    ev.type === "run.resumed" &&
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
                  <div key={item.childId} className="relative py-1">
                    <div className="absolute -left-[17px] top-3 w-2 h-2 bg-[#00aaff]" />
                    <InlineAgentCard
                      threadId={item.childId}
                      agentType={item.agentType}
                      events={childEvents}
                      status={childStatus}
                      duration={childDuration}
                      depth={depth + 1}
                      onEventClick={onEventClick}
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
      {config.icon}
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
}: TraceViewProps) {
  const [enabledFilters, setEnabledFilters] = useState<Set<EventFilter>>(
    new Set(["model", "tool", "status"])
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
      const threadId = event.threadId || "unknown";

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
        if (ev.type === "agent.completed") status = "done";
        else if (ev.type === "agent.error") status = "error";
        else if (ev.type === "run.paused" && status === "running")
          status = "paused";
        else if (ev.type === "run.resumed" && status === "paused")
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
          (e) => e.type === "agent.completed"
        );
        const hasError = threadEvents.some((e) => e.type === "agent.error");
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
          <p className="text-[10px] uppercase tracking-widest text-white/40">NO EVENTS RECORDED</p>
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
              <div className="flex items-center gap-1.5 text-[#00ff00]">
                <Check size={10} />
                <span>{stats.completed} OK</span>
              </div>
            )}
            {stats.errors > 0 && (
              <div className="flex items-center gap-1.5 text-[#ff0000]">
                <XCircle size={10} />
                <span>{stats.errors} ERR</span>
              </div>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-3 py-2 border-b border-white/30 flex items-center gap-2 flex-wrap bg-black">
          <span className="text-[10px] uppercase tracking-wider text-white/30 mr-1 hidden sm:inline">FILTER:</span>
          {(Object.keys(FILTER_CONFIG) as EventFilter[]).map((filter) => (
            <FilterButton
              key={filter}
              filter={filter}
              enabled={enabledFilters.has(filter)}
              onToggle={() => toggleFilter(filter)}
            />
          ))}
        </div>

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
