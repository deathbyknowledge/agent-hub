/**
 * Header - Top bar with agency tabs and settings
 * 
 * Supports keyboard navigation: Ctrl+1-9 to switch tabs
 */
import { useEffect } from "react";
import { cn } from "../../lib/utils";

interface AgencyMeta {
  id: string;
  name: string;
}

interface HeaderProps {
  agencies: AgencyMeta[];
  selectedAgencyId: string | null;
  onSelectAgency: (id: string) => void;
  onCreateAgency: (name?: string) => void;
  onOpenSettings: () => void;
  isSettingsActive?: boolean;
  onToggleLayout?: () => void;
}

// Filter out system agencies (starting with _)
function isUserAgency(agency: AgencyMeta): boolean {
  return !agency.id.startsWith("_") && !agency.name.startsWith("_");
}

export function Header({
  agencies,
  selectedAgencyId,
  onSelectAgency,
  onCreateAgency,
  onOpenSettings,
  isSettingsActive = false,
  onToggleLayout,
}: HeaderProps) {
  // Filter to user-visible agencies only
  const visibleAgencies = agencies.filter(isUserAgency);

  // Keyboard navigation: Ctrl+1-9 for tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+1 through Ctrl+9
      if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key, 10) - 1;
        if (index < visibleAgencies.length) {
          e.preventDefault();
          onSelectAgency(visibleAgencies[index].id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visibleAgencies, onSelectAgency]);

  return (
    <header className="h-10 flex items-center border-b border-white bg-black shrink-0">
      {/* Logo */}
      <div className="px-4 flex items-center gap-2 border-r border-white/30 h-full">
        <span className="text-white/60">&gt;</span>
        <span className="text-[10px] uppercase tracking-[0.2em] font-medium">
          AGENT_HUB
        </span>
      </div>

      {/* Agency Tabs */}
      <div className="flex-1 flex items-center h-full overflow-x-auto">
        {visibleAgencies.map((agency, index) => (
          <button
            key={agency.id}
            onClick={() => onSelectAgency(agency.id)}
            className={cn(
              "h-full px-4 text-[11px] uppercase tracking-wider border-r border-white/10 transition-colors flex items-center gap-2",
              selectedAgencyId === agency.id
                ? "bg-white text-black"
                : "text-white/60 hover:text-white hover:bg-white/5"
            )}
            title={`Ctrl+${index + 1}`}
          >
            <span className="text-[9px] opacity-50">^{index + 1}</span>
            <span># {agency.name || agency.id}</span>
          </button>
        ))}
        
        {/* Add Agency */}
        <button
          onClick={() => onCreateAgency()}
          className="h-full px-3 text-white/30 hover:text-white hover:bg-white/5 transition-colors"
          title="New Agency"
        >
          <span className="text-[11px]">[+]</span>
        </button>
      </div>

      {/* Right Actions */}
      <div className="flex items-center h-full border-l border-white/30">
        {/* Settings toggle */}
        <button
          onClick={onOpenSettings}
          className={cn(
            "h-full px-3 transition-colors",
            isSettingsActive
              ? "bg-white text-black"
              : "text-white/50 hover:text-white hover:bg-white/5"
          )}
          title="Agency Settings"
        >
          <span className="text-[11px]">[CFG]</span>
        </button>
        
        {/* Layout toggle */}
        {onToggleLayout && (
          <button
            onClick={onToggleLayout}
            className="h-full px-3 text-white/50 hover:text-white hover:bg-white/5 transition-colors border-l border-white/30"
            title="Switch to classic layout"
          >
            <span className="text-[11px]">[CLASSIC]</span>
          </button>
        )}
      </div>
    </header>
  );
}

export default Header;
