/**
 * TabBar - IDE-style tabs for open agents
 */
import { cn } from "../lib/utils";
import type { AgentSummary } from "./shared";

export interface OpenTab {
  id: string;
  agentId: string;
  agentType: string;
  isRunning?: boolean;
}

interface TabBarProps {
  tabs: OpenTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
}: TabBarProps) {
  if (tabs.length === 0) {
    return (
      <div className="h-8 bg-black border-b border-white/20 flex items-center px-2">
        <button
          onClick={onNewTab}
          className="px-3 py-1 text-[10px] uppercase tracking-wider text-white/30 hover:text-white transition-colors"
          title="New tab (Ctrl+T)"
        >
          [+] OPEN AGENT
        </button>
        <span className="text-[9px] text-white/20 ml-2">Press Ctrl+K to search</span>
      </div>
    );
  }

  return (
    <div className="h-8 bg-black border-b border-white/20 flex items-center overflow-x-auto">
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={cn(
            "group flex items-center gap-1 px-3 h-full border-r border-white/10 cursor-pointer transition-colors min-w-0",
            tab.id === activeTabId
              ? "bg-white/10 border-b-2 border-b-white"
              : "hover:bg-white/5"
          )}
          onClick={() => onSelectTab(tab.id)}
        >
          {/* Running indicator */}
          {tab.isRunning && (
            <span className="w-1.5 h-1.5 bg-[#00aaff] rounded-full animate-pulse shrink-0" />
          )}
          
          {/* Tab label */}
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider truncate max-w-[120px]",
              tab.id === activeTabId ? "text-white" : "text-white/60"
            )}
            title={`${tab.agentType} (${tab.agentId.slice(0, 6)})`}
          >
            {tab.agentType}
          </span>

          {/* Tab index for keyboard nav */}
          {index < 9 && (
            <span className="text-[8px] text-white/20 font-mono ml-1">
              {index + 1}
            </span>
          )}

          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
            className={cn(
              "ml-1 text-[10px] transition-colors shrink-0",
              tab.id === activeTabId
                ? "text-white/50 hover:text-white"
                : "text-white/30 hover:text-white/70 opacity-0 group-hover:opacity-100"
            )}
            title="Close tab (Ctrl+W)"
          >
            ×
          </button>
        </div>
      ))}

      {/* New tab button */}
      <button
        onClick={onNewTab}
        className="px-3 h-full text-[10px] text-white/30 hover:text-white hover:bg-white/5 transition-colors shrink-0"
        title="New tab (Ctrl+T)"
      >
        [+]
      </button>
    </div>
  );
}
