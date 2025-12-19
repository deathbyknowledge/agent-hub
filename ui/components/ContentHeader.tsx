import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { cn } from "../lib/utils";
import { ChatCircle, Graph, Folder, ListChecks, Copy, Check, DotsThreeVertical, Play, Stop, Trash } from "@phosphor-icons/react";

export type TabId = "chat" | "trace" | "files" | "todos";

interface Tab {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: Tab[] = [
  { id: "chat", label: "Chat", icon: <ChatCircle size={16} /> },
  { id: "trace", label: "Trace", icon: <Graph size={16} /> },
  { id: "files", label: "Files", icon: <Folder size={16} /> },
  { id: "todos", label: "Todos", icon: <ListChecks size={16} /> }
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
}

const STATUS_LABELS: Record<string, { label: string; color: string; bgColor: string }> = {
  running: { label: "Running", color: "text-blue-600", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  paused: { label: "Paused", color: "text-yellow-600", bgColor: "bg-yellow-100 dark:bg-yellow-900/30" },
  done: { label: "Done", color: "text-green-600", bgColor: "bg-green-100 dark:bg-green-900/30" },
  error: { label: "Error", color: "text-red-600", bgColor: "bg-red-100 dark:bg-red-900/30" },
  idle: { label: "Idle", color: "text-neutral-500", bgColor: "bg-neutral-100 dark:bg-neutral-800" }
};

export function ContentHeader({
  threadName,
  threadId,
  agencyId,
  activeTab,
  status = "idle",
  onRestart,
  onStop,
  onDelete
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
    <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      {/* Agent info */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {threadName}
            </span>
            <span className={cn(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
              statusInfo.color,
              statusInfo.bgColor
            )}>
              {isRunning && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
              {statusInfo.label}
            </span>
          </div>
          <button
            onClick={copyId}
            className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400 font-mono hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors group"
          >
            <span>{threadId.slice(0, 12)}...</span>
            {copied ? (
              <Check size={12} className="text-green-500" />
            ) : (
              <Copy size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
        </div>
      </div>

      {/* Tabs and actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.id}
              href={tab.id === "chat" ? basePath : `${basePath}/${tab.id}`}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
                  : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </Link>
          ))}
        </div>
        
        {/* Actions dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <DotsThreeVertical size={18} />
          </button>
          
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 py-1 z-50">
              {isRunning && onStop ? (
                <button
                  onClick={() => { onStop(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  <Stop size={14} className="text-red-500" />
                  Stop Agent
                </button>
              ) : !isRunning && onRestart ? (
                <button
                  onClick={() => { onRestart(); setShowMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  <Play size={14} className="text-green-500" />
                  Restart Agent
                </button>
              ) : !onDelete ? (
                <div className="px-3 py-2 text-sm text-neutral-400 dark:text-neutral-500">
                  No actions available
                </div>
              ) : null}
              {onDelete && (
                <>
                  {(isRunning && onStop) || (!isRunning && onRestart) ? (
                    <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
                  ) : null}
                  <button
                    onClick={() => { onDelete(); setShowMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash size={14} />
                    Delete Agent
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
