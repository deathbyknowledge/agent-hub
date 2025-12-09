import { cn } from "../lib/utils";
import { ChatCircle, Graph, Folder, ListChecks, Gear } from "./Icons";

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
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  status?: "running" | "paused" | "done" | "error" | "idle";
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  running: { label: "Running", color: "text-blue-500" },
  paused: { label: "Paused", color: "text-yellow-500" },
  done: { label: "Done", color: "text-green-500" },
  error: { label: "Error", color: "text-red-500" },
  idle: { label: "Idle", color: "text-neutral-400" }
};

export function ContentHeader({
  threadName,
  threadId,
  activeTab,
  onTabChange,
  status = "idle"
}: ContentHeaderProps) {
  const statusInfo = STATUS_LABELS[status];

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      {/* Thread info */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {threadName}
            </span>
            <span className={cn("text-xs font-medium", statusInfo.color)}>
              {statusInfo.label}
            </span>
          </div>
          <span className="text-xs text-neutral-500 dark:text-neutral-400 font-mono">
            {threadId.slice(0, 12)}...
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
                : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            )}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
