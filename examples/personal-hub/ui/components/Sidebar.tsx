import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Select } from "./Select";
import {
  type AgencyMeta,
  type AgentSummary,
  type ScheduleSummary,
  type AgentStatus,
  STATUS_BG_COLORS,
  isSystemAgent,
  shortId,
  formatRelativeTime,
} from "./shared";

interface SidebarProps {
  agencies: AgencyMeta[];
  selectedAgencyId: string | null;
  onCreateAgency: () => void;
  agents: AgentSummary[];
  selectedAgentId: string | null;
  onCreateAgent: () => void;
  schedules?: ScheduleSummary[];
  agentStatus?: Record<string, AgentStatus>;
  isLoading?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onOpenMind?: () => void;
  isMindActive?: boolean;
}

export function Sidebar({
  agencies,
  selectedAgencyId,
  onCreateAgency,
  agents,
  selectedAgentId,
  onCreateAgent,
  schedules = [],
  agentStatus = {},
  isLoading = false,
  isOpen = true,
  onClose,
  onOpenMind,
  isMindActive = false,
}: SidebarProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [schedulesExpanded, setSchedulesExpanded] = useState(true);
  const [location, navigate] = useLocation();

  // Check if we're on the settings page or home
  const isOnSettings = location.endsWith("/settings");
  const isOnHome = selectedAgencyId && location === `/${selectedAgencyId}`;

  // Close sidebar on mobile when route changes
  const prevLocationRef = useRef(location);
  useEffect(() => {
    if (prevLocationRef.current !== location) {
      if (onClose && window.innerWidth < 768) {
        onClose();
      }
    }
    prevLocationRef.current = location;
  }, [location, onClose]);

  // Prevent body scroll when sidebar is open on mobile
  useEffect(() => {
    if (isOpen && onClose && window.innerWidth < 768) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  const visibleAgents = agents.filter((a) => !isSystemAgent(a));
  const activeSchedules = schedules.filter((s) => s.status === "active");
  const pausedSchedules = schedules.filter((s) => s.status === "paused");

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
          "w-72 h-full flex flex-col bg-black border-r-2 border-white",
          "fixed md:relative inset-y-0 left-0 z-50 md:z-auto",
          "transform transition-transform duration-200 ease-out md:transform-none",
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Header */}
        <div className="p-3 border-b border-white shrink-0">
          {/* Mobile close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden absolute top-2 right-3 p-1 text-white/50 hover:text-white transition-colors"
              aria-label="Close menu"
            >
              <span className="text-xs">[X]</span>
            </button>
          )}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-white">&gt;</span>
            <span className="text-xs uppercase tracking-widest text-white font-medium">
              AGENT_HUB
            </span>
            <span className="text-white/30 text-[10px] ml-auto mr-7 md:mr-0">
              v0.1
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
              placeholder="[SELECT AGENCY]"
              className="flex-1"
            />
            <Button
              variant="secondary"
              size="sm"
              icon={<span className="text-[10px]">[+]</span>}
              onClick={() => onCreateAgency()}
              title="New Agency"
            />
          </div>

          {/* Agency Mind button */}
          {selectedAgencyId && onOpenMind && (
            <button
              onClick={onOpenMind}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-2 mt-2 text-[11px] uppercase tracking-wider transition-colors border",
                isMindActive
                  ? "bg-white text-black border-white"
                  : "text-white/70 border-white/30 hover:text-white hover:border-white hover:bg-white/10"
              )}
            >
              <span className="text-sm">&#9670;</span>
              <span>AGENCY_MIND</span>
            </button>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          {/* Agents section */}
          <div className="border-b border-white/20">
            <button
              onClick={() => setAgentsExpanded(!agentsExpanded)}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-medium text-white/50 hover:text-black hover:bg-white transition-colors"
            >
              <span className="text-[10px]">
                {agentsExpanded ? "[-]" : "[+]"}
              </span>
              <span className="uppercase tracking-widest">AGENTS</span>
              <span className="ml-auto font-mono">[{visibleAgents.length}]</span>
            </button>

            {agentsExpanded && (
              <div className="px-2 pb-2">
                {/* New agent button */}
                <button
                  onClick={onCreateAgent}
                  disabled={!selectedAgencyId}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-2 text-[11px] uppercase tracking-wider transition-colors border border-dashed border-white/30",
                    "text-white/50 hover:text-black hover:border-white hover:bg-white",
                    "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:border-white/30 disabled:hover:bg-transparent disabled:hover:text-white/50"
                  )}
                >
                  [+] NEW_AGENT
                </button>

                {/* Loading state */}
                {isLoading ? (
                  <div className="py-4 space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-2 py-2 border border-white/10"
                      >
                        <div className="w-1.5 h-1.5 bg-white/20" />
                        <div className="flex-1 space-y-1">
                          <div className="h-3 bg-white/10 w-20" />
                          <div className="h-2 bg-white/5 w-14" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : visibleAgents.length === 0 ? (
                  <div className="px-2 py-6 text-[10px] text-white/30 text-center uppercase tracking-wider">
                    {selectedAgencyId ? "// NO AGENTS ACTIVE" : "// SELECT AGENCY"}
                  </div>
                ) : (
                  <div className="mt-2 space-y-1">
                    {visibleAgents.map((agent) => {
                      const isSelected = agent.id === selectedAgentId && !isOnSettings && !isOnHome;
                      const status = agentStatus[agent.id] || "idle";
                      const isRunning = status === "running";

                      return (
                        <Link
                          key={agent.id}
                          href={`/${selectedAgencyId}/agent/${agent.id}`}
                          className={cn(
                            "w-full flex items-center gap-2 px-2 py-2 text-xs transition-all text-left relative border",
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
                                className={cn("block w-1.5 h-1.5", STATUS_BG_COLORS[status])}
                              />
                            )}
                          </span>

                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate uppercase text-[11px] tracking-wide">
                              {agent.agentType}
                            </div>
                            <div className="text-[10px] text-current opacity-50 truncate font-mono">
                              {shortId(agent.id)} | {formatRelativeTime(agent.createdAt)}
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

          {/* Schedules section */}
          {selectedAgencyId && (
            <div className="border-b border-white/20">
              <button
                onClick={() => setSchedulesExpanded(!schedulesExpanded)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-[10px] font-medium text-white/50 hover:text-black hover:bg-white transition-colors"
              >
                <span className="text-[10px]">
                  {schedulesExpanded ? "[-]" : "[+]"}
                </span>
                <span className="uppercase tracking-widest">SCHEDULES</span>
                <span className="ml-auto font-mono">[{schedules.length}]</span>
              </button>

              {schedulesExpanded && (
                <div className="px-2 pb-2">
                  {schedules.length === 0 ? (
                    <div className="px-2 py-4 text-[10px] text-white/30 text-center uppercase tracking-wider">
                      // NO SCHEDULES
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {schedules.map((schedule) => (
                        <Link
                          key={schedule.id}
                          href={`/${selectedAgencyId}/settings`}
                          className="flex items-center gap-2 px-2 py-2 text-[11px] border border-white/20 hover:border-white hover:bg-white/5 transition-colors"
                        >
                          <span
                            className={cn(
                              "w-1.5 h-1.5 shrink-0",
                              schedule.status === "active"
                                ? "bg-[#00ff00]"
                                : "bg-[#ffaa00]"
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="uppercase tracking-wide text-white/70 truncate">
                              {schedule.name || schedule.agentType}
                            </div>
                            <div className="text-[9px] text-white/40 font-mono uppercase">
                              {schedule.type} |{" "}
                              {schedule.status === "paused" ? "PAUSED" : "ACTIVE"}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}

                  {/* Schedule summary */}
                  {schedules.length > 0 && (
                    <div className="mt-2 px-2 text-[9px] text-white/30 font-mono">
                      <span className="text-[#00ff00]">●</span> {activeSchedules.length} active
                      <span className="mx-2">|</span>
                      <span className="text-[#ffaa00]">●</span> {pausedSchedules.length} paused
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer: Home + Settings */}
        <div className="border-t border-white p-2 space-y-1 shrink-0">
          {/* Home link */}
          {selectedAgencyId && (
            <Link
              href={`/${selectedAgencyId}`}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-2 text-[11px] uppercase tracking-wider transition-colors border",
                isOnHome
                  ? "bg-white text-black border-white"
                  : "text-white/50 border-white/30 hover:text-black hover:border-white hover:bg-white"
              )}
            >
              [HOME] DASHBOARD
            </Link>
          )}

          {/* Settings link */}
          <Link
            href={selectedAgencyId ? `/${selectedAgencyId}/settings` : "#"}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-2 text-[11px] uppercase tracking-wider transition-colors border",
              isOnSettings
                ? "bg-white text-black border-white"
                : "text-white/50 border-white/30 hover:text-black hover:border-white hover:bg-white",
              !selectedAgencyId && "opacity-30 pointer-events-none"
            )}
          >
            [CFG] SETTINGS
          </Link>
        </div>
      </div>
    </>
  );
}

export type { AgencyMeta, AgentSummary };
