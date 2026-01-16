/**
 * TopHeader - Top navigation bar with agency selector and actions
 */
import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import type { AgencyMeta } from "./shared";

interface TopHeaderProps {
  agencies: AgencyMeta[];
  selectedAgencyId: string | null;
  selectedAgencyName?: string;
  onSelectAgency: (agencyId: string) => void;
  onCreateAgency: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  onTogglePanel: () => void;
  isPanelOpen: boolean;
}

export function TopHeader({
  agencies,
  selectedAgencyId,
  selectedAgencyName,
  onSelectAgency,
  onCreateAgency,
  onOpenSettings,
  onOpenCommandPalette,
  onTogglePanel,
  isPanelOpen,
}: TopHeaderProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="h-10 bg-black border-b border-white flex items-center px-2 gap-2 shrink-0">
      {/* Panel toggle */}
      <button
        onClick={onTogglePanel}
        className={cn(
          "px-2 py-1 text-[10px] uppercase tracking-wider border transition-colors",
          isPanelOpen
            ? "bg-white text-black border-white"
            : "text-white/50 border-white/30 hover:text-white hover:border-white"
        )}
        title="Toggle panel (Ctrl+B)"
      >
        [=]
      </button>

      {/* Agency selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="flex items-center gap-2 px-2 py-1 text-[11px] uppercase tracking-wider border border-white/30 hover:border-white transition-colors"
        >
          <span className="text-white/50">AGENCY:</span>
          <span className="text-white font-medium">
            {selectedAgencyName || selectedAgencyId || "SELECT"}
          </span>
          <span className="text-white/30">{isDropdownOpen ? "▲" : "▼"}</span>
        </button>

        {isDropdownOpen && (
          <div className="absolute top-full left-0 mt-1 bg-black border border-white min-w-[200px] z-50">
            {agencies.map((agency) => (
              <button
                key={agency.id}
                onClick={() => {
                  onSelectAgency(agency.id);
                  setIsDropdownOpen(false);
                }}
                className={cn(
                  "w-full px-3 py-2 text-left text-[11px] uppercase tracking-wider transition-colors",
                  agency.id === selectedAgencyId
                    ? "bg-white text-black"
                    : "text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                {agency.name}
              </button>
            ))}
            <button
              onClick={() => {
                onCreateAgency();
                setIsDropdownOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-[11px] uppercase tracking-wider text-white/50 hover:bg-white/10 hover:text-white border-t border-white/20"
            >
              [+] NEW AGENCY
            </button>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Command palette trigger */}
      <button
        onClick={onOpenCommandPalette}
        className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/50 border border-white/30 hover:text-white hover:border-white transition-colors"
        title="Open command palette (Ctrl+K)"
      >
        [⌘K]
      </button>

      {/* Settings */}
      {selectedAgencyId && (
        <button
          onClick={onOpenSettings}
          className="px-2 py-1 text-[10px] uppercase tracking-wider text-white/50 border border-white/30 hover:text-white hover:border-white transition-colors"
          title="Agency settings"
        >
          [⚙]
        </button>
      )}
    </header>
  );
}
