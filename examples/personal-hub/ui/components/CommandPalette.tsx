/**
 * CommandPalette - Fuzzy search for agents and blueprints
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "../lib/utils";
import type { AgentBlueprint, AgentSummary } from "./shared";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentSummary[];
  blueprints: AgentBlueprint[];
  onSelectAgent: (agent: AgentSummary) => void;
  onCreateFromBlueprint: (blueprint: AgentBlueprint) => void;
}

type CommandItem =
  | { type: "agent"; agent: AgentSummary }
  | { type: "blueprint"; blueprint: AgentBlueprint };

export function CommandPalette({
  isOpen,
  onClose,
  agents,
  blueprints,
  onSelectAgent,
  onCreateFromBlueprint,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build searchable items
  const items: CommandItem[] = useMemo(() => {
    const result: CommandItem[] = [];
    
    // Agents first
    agents.forEach((agent) => {
      result.push({ type: "agent", agent });
    });
    
    // Then blueprints
    blueprints.forEach((blueprint) => {
      result.push({ type: "blueprint", blueprint });
    });
    
    return result;
  }, [agents, blueprints]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    
    const lowerQuery = query.toLowerCase();
    return items.filter((item) => {
      if (item.type === "agent") {
        return (
          item.agent.agentType.toLowerCase().includes(lowerQuery) ||
          item.agent.id.toLowerCase().includes(lowerQuery)
        );
      } else {
        return (
          item.blueprint.name.toLowerCase().includes(lowerQuery) ||
          item.blueprint.description?.toLowerCase().includes(lowerQuery)
        );
      }
    });
  }, [items, query]);

  // Reset selection when filtered items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector("[data-selected=true]");
      selected?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        const selected = filteredItems[selectedIndex];
        if (selected) {
          if (selected.type === "agent") {
            onSelectAgent(selected.agent);
          } else {
            onCreateFromBlueprint(selected.blueprint);
          }
          onClose();
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="relative w-full max-w-lg mx-4 bg-black border border-white shadow-2xl">
        {/* Search input */}
        <div className="border-b border-white/30">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search agents and blueprints..."
            className="w-full px-4 py-3 bg-transparent text-white text-sm placeholder:text-white/30 focus:outline-none"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[10px] text-white/30 uppercase tracking-wider">
                No results found
              </p>
            </div>
          ) : (
            <>
              {/* Section: Agents */}
              {filteredItems.some((i) => i.type === "agent") && (
                <div className="px-3 py-1.5 text-[9px] text-white/40 uppercase tracking-wider border-b border-white/10">
                  Agents
                </div>
              )}
              {filteredItems
                .filter((i) => i.type === "agent")
                .map((item, idx) => {
                  const realIndex = filteredItems.indexOf(item);
                  const agent = (item as { type: "agent"; agent: AgentSummary }).agent;
                  return (
                    <button
                      key={agent.id}
                      data-selected={realIndex === selectedIndex}
                      onClick={() => {
                        onSelectAgent(agent);
                        onClose();
                      }}
                      className={cn(
                        "w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors",
                        realIndex === selectedIndex
                          ? "bg-white text-black"
                          : "hover:bg-white/10"
                      )}
                    >
                      <span
                        className={cn(
                          "text-[9px] px-1.5 border uppercase tracking-wider",
                          realIndex === selectedIndex
                            ? "border-black/30 text-black/70"
                            : "border-[#00aaff]/50 text-[#00aaff]"
                        )}
                      >
                        AGT
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wider truncate">
                          {agent.agentType}
                        </div>
                        <div
                          className={cn(
                            "text-[9px] font-mono",
                            realIndex === selectedIndex ? "text-black/50" : "text-white/40"
                          )}
                        >
                          {agent.id.slice(0, 8)}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "text-[10px]",
                          realIndex === selectedIndex ? "text-black/40" : "text-white/30"
                        )}
                      >
                        Open →
                      </span>
                    </button>
                  );
                })}

              {/* Section: Blueprints */}
              {filteredItems.some((i) => i.type === "blueprint") && (
                <div className="px-3 py-1.5 text-[9px] text-white/40 uppercase tracking-wider border-b border-white/10 border-t border-t-white/10">
                  Blueprints (spawn new)
                </div>
              )}
              {filteredItems
                .filter((i) => i.type === "blueprint")
                .map((item) => {
                  const realIndex = filteredItems.indexOf(item);
                  const blueprint = (item as { type: "blueprint"; blueprint: AgentBlueprint }).blueprint;
                  return (
                    <button
                      key={blueprint.name}
                      data-selected={realIndex === selectedIndex}
                      onClick={() => {
                        onCreateFromBlueprint(blueprint);
                        onClose();
                      }}
                      className={cn(
                        "w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors",
                        realIndex === selectedIndex
                          ? "bg-white text-black"
                          : "hover:bg-white/10"
                      )}
                    >
                      <span
                        className={cn(
                          "text-[9px] px-1.5 border uppercase tracking-wider",
                          realIndex === selectedIndex
                            ? "border-black/30 text-black/70"
                            : "border-[#00ff00]/50 text-[#00ff00]"
                        )}
                      >
                        NEW
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] uppercase tracking-wider truncate">
                          {blueprint.name}
                        </div>
                        {blueprint.description && (
                          <div
                            className={cn(
                              "text-[9px] truncate",
                              realIndex === selectedIndex ? "text-black/50" : "text-white/40"
                            )}
                          >
                            {blueprint.description}
                          </div>
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-[10px]",
                          realIndex === selectedIndex ? "text-black/40" : "text-white/30"
                        )}
                      >
                        Create →
                      </span>
                    </button>
                  );
                })}
            </>
          )}
        </div>

        {/* Footer with shortcuts */}
        <div className="px-4 py-2 border-t border-white/20 flex items-center gap-4 text-[9px] text-white/30">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  );
}
