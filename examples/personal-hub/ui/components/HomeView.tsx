/**
 * HomeView - Dashboard home view with metrics, activity feed, and command input
 *
 * This is the landing page when an agency is selected but no agent.
 * Combines the best of Command Center into the classic layout.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { cn } from "../lib/utils";
import {
  type DashboardMetrics,
  type ActivityItem,
  type MentionTarget,
  type AgentBlueprint,
  type AgentSummary,
  isSystemBlueprint,
  isSystemAgent,
  formatNumber,
} from "./shared";

// ============================================================================
// Dashboard Component (adapted from command-center/Dashboard.tsx)
// ============================================================================

function AsciiBar({ value, max, width = 10 }: { value: number; max: number; width?: number }) {
  const filled = Math.round((value / Math.max(max, 1)) * width);
  const empty = width - filled;
  return (
    <span className="font-mono">
      <span className="text-white/70">{"█".repeat(Math.max(0, filled))}</span>
      <span className="text-white/20">{"░".repeat(Math.max(0, empty))}</span>
    </span>
  );
}

function AsciiSparkline({ data }: { data: number[] }) {
  if (data.length === 0) return <span className="text-white/20">—</span>;

  const blocks = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  const max = Math.max(...data, 1);

  return (
    <span className="font-mono text-white/50">
      {data.slice(-12).map((value, i) => {
        const level = Math.floor((value / max) * 7);
        return <span key={i}>{blocks[Math.min(level, 7)]}</span>;
      })}
    </span>
  );
}

function Percentage({ value }: { value: number }) {
  const color =
    value >= 90
      ? "text-emerald-400/70"
      : value >= 70
        ? "text-amber-400/70"
        : "text-red-400/70";
  return <span className={cn("font-mono", color)}>{value}%</span>;
}

function Duration({ ms }: { ms: number }) {
  if (ms < 1000) return <span className="font-mono">{ms}ms</span>;
  return <span className="font-mono">{(ms / 1000).toFixed(1)}s</span>;
}

function StatBox({
  label,
  value,
  subValue,
  children,
  compact = false,
}: {
  label: string;
  value: React.ReactNode;
  subValue?: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "border border-white/20",
        compact ? "p-2 min-w-[100px]" : "p-2.5 min-w-[120px]"
      )}
    >
      <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">
        {label}
      </div>
      <div className={cn("font-mono text-white/90", compact ? "text-base" : "text-lg")}>
        {value}
      </div>
      {subValue && <div className="text-[10px] text-white/40 mt-0.5">{subValue}</div>}
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

function Dashboard({ metrics }: { metrics: DashboardMetrics }) {
  const { agents, runs, schedules, tokens, responseTime, memory } = metrics;

  const agentBreakdown =
    agents.total > 0 ? `${agents.active}↑ ${agents.idle}○ ${agents.error}✕` : "—";

  return (
    <div className="p-3 sm:p-4 border-b border-white/10">
      <div className="text-[9px] uppercase tracking-widest text-white/30 mb-3">
        DASHBOARD
      </div>

      <div className="flex flex-wrap gap-2">
        <StatBox label="AGENTS" value={agents.total} subValue={agentBreakdown}>
          <AsciiBar value={agents.active} max={agents.total || 1} width={8} />
          <span className="text-[9px] text-white/30 ml-2">active</span>
        </StatBox>

        <StatBox label="RUNS" value={runs.today} subValue={`${runs.week}/wk`}>
          <AsciiSparkline data={runs.hourlyData} />
        </StatBox>

        <StatBox label="SUCCESS" value={<Percentage value={runs.successRate} />} compact>
          <AsciiBar value={runs.successRate} max={100} width={8} />
        </StatBox>

        <StatBox
          label="SCHEDULES"
          value={schedules.total}
          subValue={schedules.nextRun ? `next: ${schedules.nextRun}` : undefined}
          compact
        >
          <span className="text-[10px] font-mono">
            <span className="text-emerald-400/60">●</span>
            {schedules.active}
            <span className="text-white/20 mx-1">|</span>
            <span className="text-amber-400/60">◐</span>
            {schedules.paused}
          </span>
        </StatBox>

        {responseTime && (
          <StatBox
            label="RESP TIME"
            value={<Duration ms={responseTime.avg} />}
            subValue={`p95: ${responseTime.p95}ms`}
            compact
          >
            <AsciiSparkline data={responseTime.recentData} />
          </StatBox>
        )}

        {tokens && (
          <StatBox
            label="TOKENS"
            value={formatNumber(tokens.today)}
            subValue={`${formatNumber(tokens.week)}/wk`}
            compact
          >
            <AsciiSparkline data={tokens.dailyData} />
          </StatBox>
        )}

        {memory && (
          <StatBox
            label="MEMORY"
            value={memory.disks}
            subValue={`${memory.totalEntries} entries`}
            compact
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Activity Feed Component (adapted from command-center/ActivityFeed.tsx)
// ============================================================================

function formatActivityTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (isToday) return time;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

function getSourceName(item: ActivityItem): string {
  if (item.from === "you") return "YOU";
  if (item.type === "system") return "SYSTEM";

  const agentType = item.agentType || "";
  if (agentType === "_agency-mind") return "AGENCY MIND";
  if (agentType === "_hub-mind") return "HUB MIND";
  if (agentType.startsWith("_"))
    return agentType.slice(1).toUpperCase().replace(/-/g, " ");

  return agentType.toUpperCase();
}

function getTargetName(target: string): string {
  if (target === "_agency-mind") return "AGENCY MIND";
  if (target === "_hub-mind") return "HUB MIND";
  if (target.startsWith("_")) return target.slice(1).toUpperCase().replace(/-/g, " ");
  return target.toUpperCase();
}

function isMind(item: ActivityItem): boolean {
  const agentType = item.agentType || "";
  return agentType === "_agency-mind" || agentType === "_hub-mind";
}

function SystemMessage({ item }: { item: ActivityItem }) {
  return (
    <div className="flex justify-center my-3 px-4">
      <span className="text-[10px] uppercase tracking-widest text-white/30 border border-white/20 px-3 py-1">
        // {item.content || item.event}
      </span>
    </div>
  );
}

function UserMessage({
  item,
  onClick,
}: {
  item: ActivityItem;
  onClick?: () => void;
}) {
  const target = item.to ? getTargetName(item.to) : "";

  return (
    <div className="mb-4 px-3 sm:px-4 flex flex-col items-end">
      <div className="flex items-center gap-2 mb-1">
        {target && (
          <span className="text-[10px] text-white/40 uppercase">{target} {'<-'}</span>
        )}
        <span className="text-[10px] uppercase tracking-wider text-white/70 font-medium">
          YOU
        </span>
      </div>


      {item.content && (
        <div
          className={cn(
            "px-3 py-2 text-xs border bg-white text-black border-white max-w-[90%] sm:max-w-[85%]",
            onClick && "cursor-pointer hover:bg-white/90"
          )}
          onClick={onClick}
        >
          <p className="whitespace-pre-wrap break-words">{item.content}</p>
        </div>
      )}

      <div className="mt-1">
        <span className="text-[10px] text-white/30 font-mono">
          {formatActivityTime(item.timestamp)}
        </span>
      </div>
    </div>
  );
}

function AgentMessage({
  item,
  onClick,
}: {
  item: ActivityItem;
  onClick?: () => void;
}) {
  const sourceName = getSourceName(item);
  const isRunning = item.status === "running";
  const isMindAgent = isMind(item);
  const agentId = (item.agentId || "").slice(0, 6);

  return (
    <div className="mb-4 px-3 sm:px-4">
      <div className="flex items-center gap-2 mb-1">
        <span
          className={cn(
            "text-[10px] uppercase tracking-wider font-medium",
            isMindAgent ? "text-white" : "text-white/50"
          )}
        >
          {sourceName}
        </span>
        {agentId && (
          <span className="text-[9px] text-white/20 font-mono">{agentId}</span>
        )}
        {isRunning && (
          <span className="text-[9px] text-sky-400/70 uppercase tracking-wider blink-hard">
            running
          </span>
        )}
      </div>

      {item.content && (
        <div
          className={cn(
            "px-3 py-2 text-xs border max-w-[90%] sm:max-w-[85%]",
            isMindAgent ? "border-white" : "border-white/30",
            isRunning && "border-sky-400/40",
            onClick && "cursor-pointer hover:border-white/50 hover:bg-white/5"
          )}
          onClick={onClick}
        >
          <p className="whitespace-pre-wrap break-words text-white/90">{item.content}</p>
        </div>
      )}

      {item.type === "agent_event" && item.event && !item.content && (
        <div className="px-3 py-2 text-[11px] text-white/50 border-l-2 border-white/20">
          {item.event}
          {item.details && <span className="text-white/30">: {item.details}</span>}
        </div>
      )}

      <div className="mt-1">
        <span className="text-[10px] text-white/30 font-mono">
          {formatActivityTime(item.timestamp)}
        </span>
      </div>
    </div>
  );
}

function ActivityFeed({
  items,
  onItemClick,
}: {
  items: ActivityItem[];
  onItemClick?: (item: ActivityItem) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  useEffect(() => {
    if (shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [items]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  return (
    <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto">
      {items.length === 0 ? (
        <div className="h-full flex items-center justify-center p-4">
          <div className="text-center px-6 py-8 max-w-sm border border-white/20">
            <div className="text-white/20 text-2xl mb-4 font-mono">_</div>
            <h3 className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
              NO ACTIVITY YET
            </h3>
            <p className="text-[10px] text-white/30">
              Type a message below. Use @ to mention agents.
            </p>
          </div>
        </div>
      ) : (
        <div className="py-4">
          {items.map((item) => {
            if (item.type === "system") {
              return <SystemMessage key={item.id} item={item} />;
            }
            if (item.from === "you") {
              return (
                <UserMessage
                  key={item.id}
                  item={item}
                  onClick={item.agentId ? () => onItemClick?.(item) : undefined}
                />
              );
            }
            return (
              <AgentMessage
                key={item.id}
                item={item}
                onClick={item.agentId ? () => onItemClick?.(item) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Command Input Component (adapted from command-center/CommandInput.tsx)
// ============================================================================

function CommandInput({
  targets,
  defaultTarget,
  onSubmit,
  disabled = false,
  placeholder = "Type a message... (@ to mention)",
}: {
  targets: MentionTarget[];
  defaultTarget: string;
  onSubmit: (target: string, message: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const [selectedTarget, setSelectedTarget] = useState(defaultTarget);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);

  // Update selected target when default changes
  useEffect(() => {
    setSelectedTarget(defaultTarget);
  }, [defaultTarget]);

  const filteredTargets = useMemo(() => {
    if (!mentionFilter) return targets;
    const lower = mentionFilter.toLowerCase();
    return targets.filter((t) => t.label.toLowerCase().includes(lower));
  }, [targets, mentionFilter]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedMentionIndex(0);
  }, [filteredTargets.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (showMentions && mentionListRef.current) {
      const selected = mentionListRef.current.querySelector("[data-selected=true]");
      selected?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedMentionIndex, showMentions]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);

    // Check for @ mention
    const lastAtIndex = value.lastIndexOf("@");
    if (lastAtIndex >= 0 && lastAtIndex === value.length - 1) {
      setShowMentions(true);
      setMentionFilter("");
    } else if (lastAtIndex >= 0 && showMentions) {
      const afterAt = value.slice(lastAtIndex + 1);
      if (!afterAt.includes(" ")) {
        setMentionFilter(afterAt);
      } else {
        setShowMentions(false);
      }
    } else if (!value.includes("@")) {
      setShowMentions(false);
    }
  };

  const selectMention = useCallback(
    (target: MentionTarget) => {
      const lastAtIndex = input.lastIndexOf("@");
      const beforeAt = lastAtIndex >= 0 ? input.slice(0, lastAtIndex) : input;
      setInput(beforeAt);
      setSelectedTarget(target.id);
      setShowMentions(false);
      setMentionFilter("");
      inputRef.current?.focus();
    },
    [input]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions) {
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
        e.preventDefault();
        setSelectedMentionIndex((i) => Math.min(i + 1, filteredTargets.length - 1));
      } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
        e.preventDefault();
        setSelectedMentionIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        if (filteredTargets[selectedMentionIndex]) {
          selectMention(filteredTargets[selectedMentionIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowMentions(false);
      }
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!input.trim() || isSending || disabled) return;

    setIsSending(true);
    try {
      await onSubmit(selectedTarget, input.trim());
      setInput("");
    } finally {
      setIsSending(false);
    }
  };

  const selectedTargetLabel = useMemo(() => {
    const target = targets.find((t) => t.id === selectedTarget);
    if (!target) return "MIND";
    if (target.type === "mind") return "MIND";
    if (target.id.startsWith("new:")) return `NEW ${target.label.replace("new ", "")}`;
    return target.label;
  }, [selectedTarget, targets]);

  return (
    <div className="border-t border-white bg-black p-2 sm:p-3 relative">
      {/* Mention autocomplete */}
      {showMentions && filteredTargets.length > 0 && (
        <div
          ref={mentionListRef}
          className="absolute bottom-full left-0 right-0 mb-1 mx-2 sm:mx-3 max-h-48 overflow-y-auto bg-black border border-white z-10"
        >
          {filteredTargets.map((target, i) => (
            <button
              key={target.id}
              data-selected={i === selectedMentionIndex}
              onClick={() => selectMention(target)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors",
                i === selectedMentionIndex
                  ? "bg-white text-black"
                  : "text-white/70 hover:bg-white/10"
              )}
            >
              <span
                className={cn(
                  "text-[9px] uppercase tracking-wider px-1 border",
                  target.type === "mind"
                    ? "text-white border-white"
                    : target.type === "blueprint"
                      ? "text-[#00ff00] border-[#00ff00]/50"
                      : "text-[#00aaff] border-[#00aaff]/50"
                )}
              >
                {target.type === "mind"
                  ? "MIND"
                  : target.type === "blueprint"
                    ? "NEW"
                    : "AGT"}
              </span>
              <span className="text-[11px] uppercase tracking-wider truncate">
                {target.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-stretch gap-2">
        {/* Target indicator */}
        <div className="flex items-center px-2 border border-white/30 bg-white/5 shrink-0">
          <span className="text-[10px] uppercase tracking-wider text-white/50">@</span>
          <span className="text-[10px] uppercase tracking-wider text-white ml-1 max-w-[60px] sm:max-w-none truncate">
            {selectedTargetLabel}
          </span>
        </div>

        {/* Text input */}
        <div className="flex-1 flex items-stretch border border-white/50 focus-within:border-white transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || isSending}
            rows={1}
            className={cn(
              "w-full px-3 py-2 bg-transparent text-white text-xs font-mono",
              "placeholder:text-white/30 placeholder:uppercase resize-none",
              "focus:outline-none disabled:opacity-30"
            )}
          />
        </div>

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isSending || disabled}
          className={cn(
            "px-3 sm:px-4 py-2 text-[11px] uppercase tracking-wider border transition-colors shrink-0",
            input.trim() && !isSending && !disabled
              ? "bg-white text-black border-white hover:bg-white/90"
              : "text-white/30 border-white/30 cursor-not-allowed"
          )}
        >
          {isSending ? (
            <span className="blink-hard">...</span>
          ) : (
            <span className="hidden sm:inline">[SEND]</span>
          )}
          <span className="sm:hidden">→</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// HomeView Main Component
// ============================================================================

interface HomeViewProps {
  agencyId: string;
  agencyName?: string;
  agents: AgentSummary[];
  blueprints: AgentBlueprint[];
  metrics: DashboardMetrics;
  activityItems: ActivityItem[];
  onSendMessage: (target: string, message: string) => Promise<void>;
  /** Create a new agent from blueprint. If message is provided, send it after creation. */
  onCreateAgent: (blueprintName: string, message?: string) => Promise<void>;
  onMenuClick?: () => void;
}

export function HomeView({
  agencyId,
  agencyName,
  agents,
  blueprints,
  metrics,
  activityItems,
  onSendMessage,
  onCreateAgent,
  onMenuClick,
}: HomeViewProps) {
  const [, navigate] = useLocation();
  const [lastTarget, setLastTarget] = useState<string>("_agency-mind");

  // Build mention targets
  const mentionTargets: MentionTarget[] = useMemo(() => {
    return [
      { id: "_agency-mind", label: "agency-mind", type: "mind" as const },
      // Blueprints (spawn new agents)
      ...blueprints
        .filter((b) => !isSystemBlueprint(b))
        .map((b) => ({
          id: `new:${b.name}`,
          label: `new ${b.name}`,
          type: "blueprint" as const,
        })),
      // Existing agents
      ...agents
        .filter((a) => !isSystemAgent(a))
        .map((a) => ({
          id: a.id,
          label: a.agentType,
          type: "agent" as const,
        })),
    ];
  }, [blueprints, agents]);

  // Handle command submission
  const handleCommand = useCallback(
    async (target: string, message: string) => {
      setLastTarget(target);

      if (target.startsWith("new:")) {
        // Spawn new agent from blueprint, then send the message
        // This keeps user in the command center instead of navigating away
        const blueprintName = target.slice(4);
        await onCreateAgent(blueprintName, message);
        return;
      }

      await onSendMessage(target, message);
    },
    [onSendMessage, onCreateAgent]
  );

  // Handle activity item click - navigate to agent
  const handleActivityClick = useCallback(
    (item: ActivityItem) => {
      if (item.agentId) {
        navigate(`/${agencyId}/agent/${item.agentId}`);
      }
    },
    [agencyId, navigate]
  );

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white bg-black shrink-0">
        <div className="flex items-center gap-2">
          {/* Mobile menu button */}
          {onMenuClick && (
            <button
              onClick={onMenuClick}
              className="md:hidden p-1.5 -ml-1 text-white/50 hover:text-white transition-colors"
              aria-label="Open menu"
            >
              <span className="text-xs">[=]</span>
            </button>
          )}
          <div>
            <h1 className="text-xs uppercase tracking-widest text-white">DASHBOARD</h1>
            <p className="text-[10px] text-white/40 font-mono">
              AGENCY: {agencyName || agencyId}
            </p>
          </div>
        </div>
      </div>

      {/* Dashboard metrics */}
      <Dashboard metrics={metrics} />

      {/* Activity feed */}
      <div className="flex-1 min-h-0 border-t border-white/10">
        <ActivityFeed items={activityItems} onItemClick={handleActivityClick} />
      </div>

      {/* Command input */}
      <CommandInput
        targets={mentionTargets}
        defaultTarget={lastTarget}
        onSubmit={handleCommand}
        disabled={false}
        placeholder="Type a message... (@ to mention)"
      />
    </div>
  );
}

export default HomeView;
