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
  running: "bg-[#00aaff]",
  paused: "bg-[#ffaa00]",
  done: "bg-[#00ff00]",
  error: "bg-[#ff0000]",
  idle: "bg-white/30"
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
          className="fixed inset-0 bg-black/80 z-40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "w-64 h-full flex flex-col bg-black border-r-2 border-white",
          "fixed md:relative inset-y-0 left-0 z-50 md:z-auto",
          "transform transition-transform duration-200 ease-out md:transform-none",
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
      {/* Header */}
      <div className="p-3 border-b border-white">
        {/* Mobile close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden absolute top-3 right-3 p-1 text-white/50 hover:text-white transition-colors"
            aria-label="Close menu"
          >
            <X size={16} />
          </button>
        )}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[#00ff00]">&gt;</span>
          <span className="text-xs uppercase tracking-widest text-white font-medium">
            AGENT_HUB
          </span>
          <span className="text-white/30 text-[10px] ml-auto">v0.1</span>
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
            placeholder="[SELECT AGENCY]"
            className="flex-1"
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={12} />}
            onClick={() => onCreateAgency()}
            title="New Agency"
          />
        </div>
      </div>

      {/* Agents section */}
      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => setAgentsExpanded(!agentsExpanded)}
          className="w-full flex items-center gap-2 px-3 py-2 text-[10px] font-medium text-white/50 hover:text-black hover:bg-white transition-colors border-b border-white/20"
        >
          {agentsExpanded ? <CaretDown size={10} /> : <CaretRight size={10} />}
          <span className="uppercase tracking-widest">AGENTS</span>
          <span className="ml-auto font-mono">[{agents.length}]</span>
        </button>

        {agentsExpanded && (
          <div className="p-2">
            {/* New agent button */}
            <button
              onClick={onCreateAgent}
              disabled={!selectedAgencyId}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 text-[11px] uppercase tracking-wider transition-colors border border-dashed border-white/30",
                "text-white/50 hover:text-black hover:border-white hover:bg-white",
                "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/30 disabled:hover:bg-transparent disabled:hover:text-white/50"
              )}
            >
              <Plus size={12} />
              + NEW_AGENT
            </button>

            {/* Loading state */}
            {isLoading ? (
              <div className="py-4 space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1.5 border border-white/10">
                    <div className="w-1.5 h-1.5 bg-white/20" />
                    <div className="flex-1 space-y-1">
                      <div className="h-3 bg-white/10 w-20" />
                      <div className="h-2 bg-white/5 w-14" />
                    </div>
                  </div>
                ))}
              </div>
            ) : agents.length === 0 ? (
              <div className="px-2 py-6 text-[10px] text-white/30 text-center uppercase tracking-wider">
                {selectedAgencyId ? "// NO AGENTS ACTIVE" : "// SELECT AGENCY"}
              </div>
            ) : (
              <div className="mt-2 space-y-px">
                {agents.map((agent) => {
                  const isSelected = agent.id === selectedAgentId && !isOnSettings;
                  const status = agentStatus[agent.id] || "idle";
                  const isRunning = status === "running";

                  return (
                    <Link
                      key={agent.id}
                      href={`/${selectedAgencyId}/agent/${agent.id}`}
                      className={cn(
                        "w-full flex items-center gap-2 px-2 py-1.5 text-xs transition-all text-left relative border",
                        isSelected
                          ? "bg-white text-black border-white"
                          : isRunning
                            ? "bg-[#00aaff]/10 text-[#00aaff] border-[#00aaff]/50 hover:border-[#00aaff]"
                            : "text-white/70 border-white/20 hover:text-black hover:border-white hover:bg-white"
                      )}
                    >
                      {/* Status indicator */}
                      <span className="relative shrink-0 flex items-center justify-center w-4">
                        {isRunning ? (
                          <span className="text-[#00aaff] blink-hard">●</span>
                        ) : (
                          <span
                            className={cn(
                              "block w-1.5 h-1.5",
                              STATUS_COLORS[status]
                            )}
                          />
                        )}
                      </span>

                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate uppercase text-[11px] tracking-wide">
                          {agent.agentType}
                        </div>
                        <div className="text-[10px] text-current opacity-50 truncate font-mono">
                          {formatAgentId(agent.id)} | {formatRelativeTime(agent.createdAt)}
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
      <div className="border-t border-white p-2">
        <Link
          href={selectedAgencyId ? `/${selectedAgencyId}/settings` : "#"}
          className={cn(
            "w-full flex items-center gap-2 px-2 py-1.5 text-[11px] uppercase tracking-wider transition-colors border",
            isOnSettings
              ? "bg-white text-black border-white"
              : "text-white/50 border-white/30 hover:text-black hover:border-white hover:bg-white",
            !selectedAgencyId && "opacity-30 pointer-events-none"
          )}
        >
          <Gear size={12} />
          SETTINGS
        </Link>
      </div>
    </div>
    </>
  );
}

export type { AgencyMeta, AgentSummary };
