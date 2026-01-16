/**
 * AgentPanel - Toggleable sidebar showing agents and blueprints
 */
import { useState } from "react";
import { cn } from "../lib/utils";
import type { AgentBlueprint, AgentSummary } from "./shared";
import { shortId, formatRelativeTime } from "./shared";

interface AgentPanelProps {
  isOpen: boolean;
  agents: AgentSummary[];
  blueprints: AgentBlueprint[];
  runningAgentIds?: Set<string>;
  onSelectAgent: (agent: AgentSummary) => void;
  onCreateFromBlueprint: (blueprint: AgentBlueprint) => void;
}

export function AgentPanel({
  isOpen,
  agents,
  blueprints,
  runningAgentIds = new Set(),
  onSelectAgent,
  onCreateFromBlueprint,
}: AgentPanelProps) {
  const [agentsExpanded, setAgentsExpanded] = useState(true);
  const [blueprintsExpanded, setBlueprintsExpanded] = useState(true);

  if (!isOpen) return null;

  return (
    <div className="w-56 bg-black border-r border-white/20 flex flex-col overflow-hidden shrink-0">
      {/* Agents section */}
      <div className="border-b border-white/10">
        <button
          onClick={() => setAgentsExpanded(!agentsExpanded)}
          className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-white/50 hover:text-white hover:bg-white/5 transition-colors"
        >
          <span>{agentsExpanded ? "[-]" : "[+]"}</span>
          <span className="uppercase tracking-widest">AGENTS</span>
          <span className="ml-auto font-mono">[{agents.length}]</span>
        </button>

        {agentsExpanded && (
          <div className="pb-2">
            {agents.length === 0 ? (
              <p className="px-3 py-4 text-[9px] text-white/30 uppercase tracking-wider text-center">
                No agents
              </p>
            ) : (
              <div className="space-y-0.5 px-1">
                {agents.map((agent) => {
                  const isRunning = runningAgentIds.has(agent.id);
                  return (
                    <button
                      key={agent.id}
                      onClick={() => onSelectAgent(agent)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5 transition-colors group"
                    >
                      {/* Running indicator */}
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          isRunning ? "bg-[#00aaff] animate-pulse" : "bg-white/20"
                        )}
                      />
                      
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-white/80 truncate group-hover:text-white">
                          {agent.agentType}
                        </div>
                        <div className="text-[8px] text-white/30 font-mono">
                          {shortId(agent.id)}
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

      {/* Blueprints section */}
      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => setBlueprintsExpanded(!blueprintsExpanded)}
          className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-white/50 hover:text-white hover:bg-white/5 transition-colors"
        >
          <span>{blueprintsExpanded ? "[-]" : "[+]"}</span>
          <span className="uppercase tracking-widest">BLUEPRINTS</span>
          <span className="ml-auto font-mono">[{blueprints.length}]</span>
        </button>

        {blueprintsExpanded && (
          <div className="pb-2">
            {blueprints.length === 0 ? (
              <p className="px-3 py-4 text-[9px] text-white/30 uppercase tracking-wider text-center">
                No blueprints
              </p>
            ) : (
              <div className="space-y-0.5 px-1">
                {blueprints.map((blueprint) => (
                  <button
                    key={blueprint.name}
                    onClick={() => onCreateFromBlueprint(blueprint)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5 transition-colors group"
                  >
                    <span className="text-[8px] text-[#00ff00]/60 group-hover:text-[#00ff00]">
                      [+]
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wider text-white/80 truncate group-hover:text-white">
                        {blueprint.name}
                      </div>
                      {blueprint.description && (
                        <div className="text-[8px] text-white/30 truncate">
                          {blueprint.description}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-white/10 text-[8px] text-white/20">
        Ctrl+B to toggle
      </div>
    </div>
  );
}
