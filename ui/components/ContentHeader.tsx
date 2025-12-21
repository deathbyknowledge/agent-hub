import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { cn } from "../lib/utils";
import { ChatCircle, Graph, Folder, ListChecks, Copy, Check, DotsThreeVertical, Play, Stop, Trash, List } from "@phosphor-icons/react";

export type TabId = "chat" | "trace" | "files" | "todos";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: "chat", label: "CHAT", icon: <ChatCircle size={12} /> },
  { id: "trace", label: "TRACE", icon: <Graph size={12} /> },
  { id: "files", label: "FILES", icon: <Folder size={12} /> },
  { id: "todos", label: "TASKS", icon: <ListChecks size={12} /> }
];

interface ContentHeaderProps {
  threadName: string;
  threadId: string;
  agencyId: string;
  activeTab: TabId;
  status?: "running" | "paused" | "done" | "error" | "idle";
  onRestart?: () => void;
  onStop?: () => void;
  onDelete?: () => void;
  onMenuClick?: () => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string; borderColor: string }> = {
  running: { label: "RUNNING", color: "text-[#00aaff]", borderColor: "border-[#00aaff]" },
  paused: { label: "PAUSED", color: "text-[#ffaa00]", borderColor: "border-[#ffaa00]" },
  done: { label: "COMPLETE", color: "text-[#00ff00]", borderColor: "border-[#00ff00]" },
  error: { label: "ERROR", color: "text-[#ff0000]", borderColor: "border-[#ff0000]" },
  idle: { label: "IDLE", color: "text-white/50", borderColor: "border-white/30" }
};

export function ContentHeader({
  threadName,
  threadId,
  agencyId,
  activeTab,
  status = "idle",
  onRestart,
  onStop,
  onDelete,
  onMenuClick
}: ContentHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Build base path for tab links
  const basePath = `/${agencyId}/agent/${threadId}`;
  const statusInfo = STATUS_LABELS[status];
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
    <div className="flex items-center justify-between px-3 py-2 border-b border-white bg-black">
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
          <List size={16} />
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
            {copied ? (
              <Check size={10} className="text-[#00ff00]" />
            ) : (
              <Copy size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        </div>
      </div>

      {/* Tabs and actions */}
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex items-center overflow-x-auto [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={tab.id === "chat" ? basePath : `${basePath}/${tab.id}`}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider transition-colors whitespace-nowrap border-r border-white/20 last:border-r-0",
                activeTab === tab.id
                  ? "bg-white text-black"
                  : "text-white/50 hover:text-white hover:bg-white/10"
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </Link>
          ))}
        </div>
        
        {/* Actions dropdown */}
        <div className="relative ml-1" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors border border-white/20"
          >
            <DotsThreeVertical size={14} />
          </button>
          
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-black border border-white py-1 z-50">
              {isRunning && onStop ? (
                <button
                  onClick={() => { onStop(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#ff0000] hover:bg-[#ff0000]/10"
                >
                  <Stop size={12} />
                  TERMINATE
                </button>
              ) : !isRunning && onRestart ? (
                <button
                  onClick={() => { onRestart(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#00ff00] hover:bg-[#00ff00]/10"
                >
                  <Play size={12} />
                  RESTART
                </button>
              ) : !onDelete ? (
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-white/30">
                  // NO ACTIONS
                </div>
              ) : null}
              {onDelete && (
                <>
                  {(isRunning && onStop) || (!isRunning && onRestart) ? (
                    <div className="border-t border-white/20 my-1" />
                  ) : null}
                  <button
                    onClick={() => { onDelete(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-[#ff0000] hover:bg-[#ff0000]/10"
                  >
                    <Trash size={12} />
                    DELETE
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
