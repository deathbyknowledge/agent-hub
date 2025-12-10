import { useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Plus, Robot, Gear, CaretDown, CaretRight } from "./Icons";

// Types
interface AgencyMeta {
  id: string;
  name: string;
  createdAt: string;
}

interface AgentSummary {
  id: string;
  agentType: string;
  createdAt: string;
}

interface SidebarProps {
  agencies: AgencyMeta[];
  selectedAgencyId: string | null;
  onCreateAgency: () => void;
  threads: AgentSummary[];
  selectedThreadId: string | null;
  onCreateThread: () => void;
  threadStatus?: Record<
    string,
    "running" | "paused" | "done" | "error" | "idle"
  >;
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500",
  paused: "bg-yellow-500",
  done: "bg-green-500",
  error: "bg-red-500",
  idle: "bg-neutral-400"
};

function formatThreadId(id: string): string {
  return id.slice(0, 8);
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function Sidebar({
  agencies,
  selectedAgencyId,
  onCreateAgency,
  threads,
  selectedThreadId,
  onCreateThread,
  threadStatus = {}
}: SidebarProps) {
  const [threadsExpanded, setThreadsExpanded] = useState(true);
  const [, navigate] = useLocation();

  return (
    <div className="w-64 h-full flex flex-col bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800">
      {/* Header */}
      <div className="p-4 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-2 mb-3">
          <Robot size={20} className="text-orange-500" />
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
            Agent Hub
          </span>
        </div>

        {/* Agency selector */}
        <div className="flex gap-2">
          <select
            value={selectedAgencyId || ""}
            onChange={(e) => {
              const id = e.target.value;
              if (id) navigate(`/${id}`);
              else navigate("/");
            }}
            className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          >
            <option value="">Select agency...</option>
            {agencies.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => onCreateAgency()}
            title="New Agency"
          />
        </div>
      </div>

      {/* Threads section */}
      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => setThreadsExpanded(!threadsExpanded)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
        >
          {threadsExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
          THREADS
          <span className="ml-auto text-neutral-400">{threads.length}</span>
        </button>

        {threadsExpanded && (
          <div className="px-2 pb-2">
            {/* New thread button */}
            <button
              onClick={onCreateThread}
              disabled={!selectedAgencyId}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <Plus size={14} />
              New Thread
            </button>

            {/* Thread list */}
            {threads.length === 0 ? (
              <div className="px-3 py-4 text-xs text-neutral-400 text-center">
                {selectedAgencyId ? "No threads yet" : "Select an agency first"}
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                {threads.map((thread) => {
                  const isSelected = thread.id === selectedThreadId;
                  const status = threadStatus[thread.id] || "idle";

                  return (
                    <Link
                      key={thread.id}
                      href={`/${selectedAgencyId}/agent/${thread.id}`}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left",
                        isSelected
                          ? "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300"
                          : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      )}
                    >
                      {/* Status indicator */}
                      <span
                        className={cn(
                          "w-2 h-2 rounded-full shrink-0",
                          STATUS_COLORS[status]
                        )}
                      />

                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {thread.agentType}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                          {formatThreadId(thread.id)} ·{" "}
                          {formatRelativeTime(thread.createdAt)}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Settings button */}
      <div className="border-t border-neutral-200 dark:border-neutral-800 p-2">
        <Link
          href={selectedAgencyId ? `/${selectedAgencyId}/settings` : "#"}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
            "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800",
            !selectedAgencyId && "opacity-50 pointer-events-none"
          )}
        >
          <Gear size={16} />
          Agency Settings
        </Link>
      </div>
    </div>
  );
}

export type { AgencyMeta, AgentSummary };
