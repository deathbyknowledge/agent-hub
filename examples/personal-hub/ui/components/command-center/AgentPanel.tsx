/**
 * AgentPanel - Left sidebar showing agents and schedules
 */
import { useState } from "react";
import { cn } from "../../lib/utils";

interface AgentSummary {
  id: string;
  agentType: string;
  createdAt: string;
}

interface ScheduleSummary {
  id: string;
  name?: string;
  agentType: string;
  status: "active" | "paused";
  type: "once" | "cron" | "interval";
}

interface AgentPanelProps {
  agents: AgentSummary[];
  schedules: ScheduleSummary[];
  agentStatus: Record<string, "running" | "paused" | "done" | "error" | "idle">;
  onAgentClick: (agentId: string) => void;
  onCreateAgent: () => void;
  onScheduleClick: (scheduleId: string) => void;
  onCreateSchedule: () => void;
  isLoading?: boolean;
}

// Subdued status colors - less saturated
const STATUS_COLORS: Record<string, string> = {
  running: "bg-sky-400/70",
  paused: "bg-amber-400/60",
  done: "bg-emerald-400/50",
  error: "bg-red-400/70",
  idle: "bg-white/20",
  active: "bg-emerald-400/50",
};

function formatAgentId(id: string): string {
  return id.slice(0, 6);
}

function isSystemAgent(agent: AgentSummary): boolean {
  return agent.agentType.startsWith("_");
}

export function AgentPanel({
  agents,
  schedules,
  agentStatus,
  onAgentClick,
  onCreateAgent,
  onScheduleClick,
  onCreateSchedule,
  isLoading = false,
}: AgentPanelProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [schedulesExpanded, setSchedulesExpanded] = useState(true);

  // Filter out system agents
  const visibleAgents = agents.filter((a) => !isSystemAgent(a));

  return (
    <div className="w-48 flex flex-col bg-black shrink-0 overflow-hidden">
      {/* Agents Section */}
      <div className="flex flex-col">
        <button
          onClick={() => setAgentsExpanded(!agentsExpanded)}
          className="flex items-center gap-2 px-3 py-2 text-[10px] text-white/50 hover:text-white hover:bg-white/5 transition-colors border-b border-white/10"
        >
          <span>{agentsExpanded ? "[-]" : "[+]"}</span>
          <span className="uppercase tracking-widest flex-1 text-left">AGENTS</span>
          <span className="font-mono">{visibleAgents.length}</span>
        </button>

        {agentsExpanded && (
          <div className="flex flex-col">
            {/* Create button */}
            <button
              onClick={onCreateAgent}
              className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-white/30 hover:text-white hover:bg-white/5 transition-colors border-b border-white/5"
            >
              <span>[+]</span>
              <span className="uppercase tracking-wider">NEW</span>
            </button>

            {/* Agent list */}
            {isLoading ? (
              <div className="px-3 py-4">
                <div className="h-2 bg-white/10 animate-pulse" />
              </div>
            ) : visibleAgents.length === 0 ? (
              <div className="px-3 py-4 text-[10px] text-white/20 uppercase">
                No agents
              </div>
            ) : (
              <div className="flex flex-col max-h-48 overflow-y-auto">
                {visibleAgents.map((agent) => {
                  const status = agentStatus[agent.id] || "idle";
                  const isRunning = status === "running";

                    return (
                      <button
                        key={agent.id}
                        onClick={() => onAgentClick(agent.id)}
                        className={cn(
                          "flex items-center gap-2 px-3 py-1.5 text-left transition-colors border-b border-white/5",
                          isRunning
                            ? "bg-sky-500/10 text-sky-300/90"
                            : "text-white/70 hover:text-white hover:bg-white/5"
                        )}
                      >
                        {/* Status dot */}
                        {isRunning ? (
                          <span className="text-sky-400/80 text-xs blink-hard">●</span>
                        ) : (
                          <span
                            className={cn("w-1.5 h-1.5 shrink-0", STATUS_COLORS[status])}
                          />
                        )}

                      {/* Agent info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wide truncate">
                          {agent.agentType}
                        </div>
                        <div className="text-[9px] text-current opacity-50 font-mono">
                          {formatAgentId(agent.id)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Schedules Section */}
      <div className="flex flex-col border-t border-white/20">
        <button
          onClick={() => setSchedulesExpanded(!schedulesExpanded)}
          className="flex items-center gap-2 px-3 py-2 text-[10px] text-white/50 hover:text-white hover:bg-white/5 transition-colors border-b border-white/10"
        >
          <span>{schedulesExpanded ? "[-]" : "[+]"}</span>
          <span className="uppercase tracking-widest flex-1 text-left">SCHEDULES</span>
          <span className="font-mono">{schedules.length}</span>
        </button>

        {schedulesExpanded && (
          <div className="flex flex-col">
            {/* Create button */}
            <button
              onClick={onCreateSchedule}
              className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-white/30 hover:text-white hover:bg-white/5 transition-colors border-b border-white/5"
            >
              <span>[+]</span>
              <span className="uppercase tracking-wider">NEW</span>
            </button>

            {/* Schedule list */}
            {schedules.length === 0 ? (
              <div className="px-3 py-4 text-[10px] text-white/20 uppercase">
                No schedules
              </div>
            ) : (
              <div className="flex flex-col max-h-32 overflow-y-auto">
                {schedules.map((schedule) => (
                  <button
                    key={schedule.id}
                    onClick={() => onScheduleClick(schedule.id)}
                    className="flex items-center gap-2 px-3 py-1.5 text-left text-white/70 hover:text-white hover:bg-white/5 transition-colors border-b border-white/5"
                  >
                    {/* Status indicator */}
                    <span
                      className={cn(
                        "w-1.5 h-1.5 shrink-0",
                        schedule.status === "active" ? "bg-[#00ff00]" : "bg-white/30"
                      )}
                    />

                    {/* Schedule info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] uppercase tracking-wide truncate">
                        {schedule.name || schedule.agentType}
                      </div>
                      <div className="text-[9px] text-current opacity-50">
                        {schedule.type}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Agency Mind Quick Access */}
      <button
        onClick={() => {/* TODO: Focus input with @agency-mind */}}
        className="flex items-center gap-2 px-3 py-2 text-white/40 hover:text-white hover:bg-white/5 transition-colors border-t border-white/20"
      >
        <span className="text-sm">&#9670;</span>
        <span className="text-[10px] uppercase tracking-wider">MIND</span>
      </button>
    </div>
  );
}

export default AgentPanel;
