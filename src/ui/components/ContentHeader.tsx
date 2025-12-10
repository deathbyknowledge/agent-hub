import { useState } from "react";
import { Link } from "wouter";
import { cn } from "../lib/utils";
import { ChatCircle, Graph, Folder, ListChecks, Copy, Check } from "./Icons";

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
  status = "idle"
}: ContentHeaderProps) {
  const [copied, setCopied] = useState(false);
  
  // Build base path for tab links
  const basePath = `/${agencyId}/agent/${threadId}`;
  const statusInfo = STATUS_LABELS[status];
  const isRunning = status === "running";
  
  const copyId = async () => {
    await navigator.clipboard.writeText(threadId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

      {/* Tabs */}
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
    </div>
  );
}
