/**
 * ContentHeader - Agent header with status and actions
 * 
 * Simplified version without tabs - just shows agent info, status, and action menu.
 */
import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";

interface ContentHeaderProps {
  threadName: string;
  threadId: string;
  status?: "running" | "paused" | "done" | "error" | "idle";
  onRestart?: () => void;
  onStop?: () => void;
  onDelete?: () => void;
  onMenuClick?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; borderColor: string }> = {
  running: { label: "RUNNING", color: "text-[#00aaff]", borderColor: "border-[#00aaff]" },
  paused: { label: "PAUSED", color: "text-[#ffaa00]", borderColor: "border-[#ffaa00]" },
  done: { label: "COMPLETE", color: "text-[#00ff00]", borderColor: "border-[#00ff00]" },
  error: { label: "ERROR", color: "text-[#ff0000]", borderColor: "border-[#ff0000]" },
  idle: { label: "IDLE", color: "text-white/50", borderColor: "border-white/30" }
};

export function ContentHeader({
  threadName,
  threadId,
  status = "idle",
  onRestart,
  onStop,
  onDelete,
  onMenuClick
}: ContentHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  const statusInfo = STATUS_CONFIG[status];
  const isRunning = status === "running";
  
  const copyId = async () => {
    await navigator.clipboard.writeText(threadId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  return (
    <div className="px-3 py-2 flex items-center gap-3 border-b border-white/30 bg-black shrink-0">
      {/* Mobile menu button */}
      {onMenuClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick();
          }}
          className="md:hidden p-1.5 -ml-1 text-white/50 hover:text-white transition-colors"
          aria-label="Open menu"
        >
          <span className="text-xs">[=]</span>
        </button>
      )}

      {/* Agent info */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-white truncate">
              {threadName}
            </span>
            <span className={cn(
              "inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider border",
              statusInfo.color,
              statusInfo.borderColor
            )}>
              {isRunning && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full bg-[#00aaff] opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 bg-[#00aaff]" />
                </span>
              )}
              {statusInfo.label}
            </span>
          </div>
          <button
            onClick={copyId}
            className="flex items-center gap-1 text-[10px] text-white/40 font-mono hover:text-white transition-colors group truncate"
          >
            <span className="hidden sm:inline">ID:{threadId.slice(0, 12)}</span>
            <span className="sm:hidden">ID:{threadId.slice(0, 8)}</span>
            <span className="text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">
              {copied ? "[OK]" : "[CP]"}
            </span>
          </button>
        </div>
      </div>

      {/* Actions menu */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Quick stop button when running */}
        {isRunning && onStop && (
          <button
            onClick={onStop}
            className="px-2 py-1 text-[10px] uppercase tracking-wider text-[#ff0000] border border-[#ff0000]/50 hover:bg-[#ff0000]/10 transition-colors"
          >
            [■] STOP
          </button>
        )}

        {/* Dropdown menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors border border-white/20"
          >
            <span className="text-[10px] leading-none">⋮</span>
          </button>
          
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-black border border-white py-1 z-50">
              {!isRunning && onRestart && (
                <button
                  onClick={() => { onRestart(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#00ff00] hover:bg-[#00ff00]/10"
                >
                  [▶] RESTART
                </button>
              )}
              {isRunning && onStop && (
                <button
                  onClick={() => { onStop(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#ff0000] hover:bg-[#ff0000]/10"
                >
                  [■] TERMINATE
                </button>
              )}
              {onDelete && (
                <>
                  {(onRestart || onStop) && <div className="border-t border-white/20 my-1" />}
                  <button
                    onClick={() => { onDelete(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#ff0000] hover:bg-[#ff0000]/10"
                  >
                    [X] DELETE
                  </button>
                </>
              )}
              {!onRestart && !onStop && !onDelete && (
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-white/30">
                  // NO ACTIONS
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Keep TabId export for backwards compatibility during transition
export type TabId = "chat" | "trace" | "files" | "todos";
