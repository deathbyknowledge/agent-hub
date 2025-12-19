import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Select } from "./Select";
import { Plus, HeadCircuitIcon, Gear, CaretDown, CaretRight, X } from "@phosphor-icons/react";

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
  agents: AgentSummary[];
  selectedAgentId: string | null;
  onCreateAgent: () => void;
  agentStatus?: Record<
    string,
    "running" | "paused" | "done" | "error" | "idle"
  >;
  isLoading?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500",
  paused: "bg-yellow-500",
  done: "bg-green-500",
  error: "bg-red-500",
  idle: "bg-neutral-400"
};

function formatAgentId(id: string): string {
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
  agents,
  selectedAgentId,
  onCreateAgent,
  agentStatus = {},
  isLoading = false,
  isOpen = true,
  onClose
}: SidebarProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [location, navigate] = useLocation();
  
  // Check if we're on the settings page
  const isOnSettings = location.endsWith('/settings');

  // Close sidebar on mobile when route changes (but not on initial mount)
  const prevLocationRef = useRef(location);
  useEffect(() => {
    if (prevLocationRef.current !== location) {
      if (onClose && window.innerWidth < 768) {
        onClose();
      }
    }
    prevLocationRef.current = location;
  }, [location]);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isOpen && onClose && window.innerWidth < 768) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && onClose && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "w-64 h-full flex flex-col bg-white dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800",
          "fixed md:relative inset-y-0 left-0 z-50 md:z-auto",
          "transform transition-transform duration-300 ease-in-out md:transform-none",
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
      {/* Header */}
      <div className="p-4 border-b border-neutral-200 dark:border-neutral-800">
        {/* Mobile close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden absolute top-4 right-4 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
        )}
        <div className="flex items-center gap-2 mb-3">
          <HeadCircuitIcon size={20} className="text-orange-500" />
          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
            Agent Hub
          </span>
        </div>

        {/* Agency selector */}
        <div className="flex gap-2">
          <Select
            value={selectedAgencyId || ""}
            onChange={(id) => {
              if (id) navigate(`/${id}`);
              else navigate("/");
            }}
            options={agencies.map((a) => ({ label: a.name, value: a.id }))}
            placeholder="Select agency..."
            className="flex-1 text-xs py-1.5"
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => onCreateAgency()}
            title="New Agency"
          />
        </div>
      </div>

      {/* Agents section */}
      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => setAgentsExpanded(!agentsExpanded)}
          className="w-full flex items-center gap-2 px-4 py-2 text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
        >
          {agentsExpanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
          AGENTS
          <span className="ml-auto text-neutral-400">{agents.length}</span>
        </button>

        {agentsExpanded && (
          <div className="px-2 pb-2">
            {/* New agent button */}
            <button
              onClick={onCreateAgent}
              disabled={!selectedAgencyId}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <Plus size={14} />
              New Agent
            </button>

            {/* Loading state */}
            {isLoading ? (
              <div className="px-3 py-4 space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse flex items-center gap-2 px-3 py-2">
                    <div className="w-2 h-2 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                    <div className="flex-1 space-y-1">
                      <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-24" />
                      <div className="h-3 bg-neutral-100 dark:bg-neutral-800 rounded w-16" />
                    </div>
                  </div>
                ))}
              </div>
            ) : agents.length === 0 ? (
              <div className="px-3 py-4 text-xs text-neutral-400 text-center">
                {selectedAgencyId ? "No agents yet" : "Select an agency first"}
              </div>
            ) : (
              <div className="mt-1 space-y-0.5">
                {agents.map((agent) => {
                  const isSelected = agent.id === selectedAgentId && !isOnSettings;
                  const status = agentStatus[agent.id] || "idle";
                  const isRunning = status === "running";

                  return (
                    <Link
                      key={agent.id}
                      href={`/${selectedAgencyId}/agent/${agent.id}`}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left relative overflow-hidden",
                        isSelected
                          ? "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300"
                          : isRunning
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      )}
                    >
                      {isRunning && !isSelected && (
                        <span className="absolute inset-0 bg-blue-400/10 dark:bg-blue-400/5 animate-pulse" />
                      )}
                      {/* Status indicator with pulse for running */}
                      <span className="relative shrink-0">
                        <span
                          className={cn(
                            "block w-2 h-2 rounded-full",
                            STATUS_COLORS[status]
                          )}
                        />
                        {isRunning && (
                          <span
                            className={cn(
                              "absolute inset-0 w-2 h-2 rounded-full animate-ping",
                              STATUS_COLORS[status]
                            )}
                          />
                        )}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {agent.agentType}
                        </div>
                        <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                          {formatAgentId(agent.id)} ·{" "}
                          {formatRelativeTime(agent.createdAt)}
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
            isOnSettings
              ? "bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300"
              : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800",
            !selectedAgencyId && "opacity-50 pointer-events-none"
          )}
        >
          <Gear size={16} />
          Agency Settings
        </Link>
      </div>
    </div>
    </>
  );
}

export type { AgencyMeta, AgentSummary };
