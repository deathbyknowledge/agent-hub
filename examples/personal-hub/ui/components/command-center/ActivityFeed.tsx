/**
 * ActivityFeed - Unified chronological stream of all activity
 * 
 * Combines the best of ChatView styling with unified stream:
 * - Name on TOP for consistent alignment
 * - User messages RIGHT-ALIGNED
 * - Bordered bubbles for clear visual distinction
 * - Inverted colors for user messages
 * - Subtle differentiation for Minds
 * - Short agent ID in header
 */
import { useRef, useEffect } from "react";
import { cn } from "../../lib/utils";
import type { ActivityItem } from "../../hooks";

export type { ActivityItem };

interface ActivityFeedProps {
  items: ActivityItem[];
  onItemClick?: (item: ActivityItem) => void;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  
  if (isToday) return time;
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

// Get clean display name for the source
function getSourceName(item: ActivityItem): string {
  if (item.from === "you") return "YOU";
  if (item.type === "system") return "SYSTEM";
  
  const agentType = item.agentType || "";
  
  // Clean up system agent names
  if (agentType === "_agency-mind") return "AGENCY MIND";
  if (agentType === "_hub-mind") return "HUB MIND";
  if (agentType.startsWith("_")) return agentType.slice(1).toUpperCase().replace(/-/g, " ");
  
  return agentType.toUpperCase();
}

// Get clean target name
function getTargetName(target: string): string {
  if (target === "_agency-mind") return "AGENCY MIND";
  if (target === "_hub-mind") return "HUB MIND";
  if (target.startsWith("_")) return target.slice(1).toUpperCase().replace(/-/g, " ");
  return target.toUpperCase();
}

// Check if this is a Mind agent
function isMind(item: ActivityItem): boolean {
  const agentType = item.agentType || "";
  return agentType === "_agency-mind" || agentType === "_hub-mind";
}

// Get short ID
function shortId(id: string | undefined): string {
  if (!id) return "";
  return id.slice(0, 6);
}

// System message - centered, subtle
function SystemMessage({ item }: { item: ActivityItem }) {
  return (
    <div className="flex justify-center my-3 px-4">
      <span className="text-[10px] uppercase tracking-widest text-white/30 border border-white/20 px-3 py-1">
        // {item.content || item.event}
      </span>
    </div>
  );
}

// User message - RIGHT ALIGNED, name on top, inverted bubble
function UserMessage({ 
  item, 
  onClick 
}: { 
  item: ActivityItem; 
  onClick?: () => void;
}) {
  const target = item.to ? getTargetName(item.to) : "";

  return (
    <div className="mb-4 px-4 flex flex-col items-end">
      {/* Header: target + name */}
      <div className="flex items-center gap-2 mb-1">
        {target && (
          <span className="text-[10px] text-white/40 uppercase">
            → {target}
          </span>
        )}
        <span className="text-[10px] uppercase tracking-wider text-white/70 font-medium">
          YOU
        </span>
      </div>

      {/* Message bubble - inverted colors */}
      {item.content && (
        <div 
          className={cn(
            "px-3 py-2 text-xs border bg-white text-black border-white max-w-[85%]",
            onClick && "cursor-pointer hover:bg-white/90"
          )}
          onClick={onClick}
        >
          <p className="whitespace-pre-wrap break-words">{item.content}</p>
        </div>
      )}

      {/* Timestamp */}
      <div className="mt-1">
        <span className="text-[10px] text-white/30 font-mono">
          {formatTime(item.timestamp)}
        </span>
      </div>
    </div>
  );
}

// Agent message - LEFT ALIGNED, name on top, bordered bubble
// Minds get subtle differentiation
function AgentMessage({ 
  item, 
  onClick 
}: { 
  item: ActivityItem; 
  onClick?: () => void;
}) {
  const sourceName = getSourceName(item);
  const isRunning = item.status === "running";
  const isMindAgent = isMind(item);
  const agentId = shortId(item.agentId);

  return (
    <div className="mb-4 px-4">
      {/* Header: name + id + status */}
      <div className="flex items-center gap-2 mb-1">
        <span className={cn(
          "text-[10px] uppercase tracking-wider font-medium",
          isMindAgent ? "text-white" : "text-white/50" // Mind: white name
        )}>
          {sourceName}
        </span>
        {agentId && (
          <span className="text-[9px] text-white/20 font-mono">
            {agentId}
          </span>
        )}
        {isRunning && (
          <span className="text-[9px] text-sky-400/70 uppercase tracking-wider blink-hard">
            running
          </span>
        )}
      </div>

      {/* Message bubble - bordered, Minds get white border */}
      {item.content && (
        <div 
          className={cn(
            "px-3 py-2 text-xs border max-w-[85%]",
            isMindAgent 
              ? "border-white" // Mind: solid white border
              : "border-white/30",
            isRunning && "border-sky-400/40",
            onClick && "cursor-pointer hover:border-white/50 hover:bg-white/5"
          )}
          onClick={onClick}
        >
          <p className="whitespace-pre-wrap break-words text-white/90">{item.content}</p>
        </div>
      )}

      {/* Event info (non-message) */}
      {item.type === "agent_event" && item.event && !item.content && (
        <div className="px-3 py-2 text-[11px] text-white/50 border-l-2 border-white/20">
          {item.event}
          {item.details && <span className="text-white/30">: {item.details}</span>}
        </div>
      )}

      {/* Timestamp */}
      <div className="mt-1">
        <span className="text-[10px] text-white/30 font-mono">
          {formatTime(item.timestamp)}
        </span>
      </div>
    </div>
  );
}

export function ActivityFeed({ items, onItemClick }: ActivityFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // Auto-scroll to bottom when new items arrive (instant, no animation)
  useEffect(() => {
    if (shouldAutoScroll.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [items]);

  // Detect if user scrolled up
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto"
    >
      {items.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <div className="text-center px-8 py-12 max-w-sm border border-white/20">
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

export default ActivityFeed;
