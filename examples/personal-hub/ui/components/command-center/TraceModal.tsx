/**
 * TraceModal - Modal dialog for viewing agent trace/events
 * 
 * Uses the existing TraceView component in a centered modal.
 */
import { useState, useEffect } from "react";
import { TraceView } from "../TraceView";
import type { AgentEvent } from "agent-hub/client";

interface TraceModalProps {
  agencyId: string;
  agentId: string;
  agentType: string;
  getEvents: (agentId: string) => Promise<AgentEvent[]>;
  onClose: () => void;
}

export function TraceModal({
  agencyId,
  agentId,
  agentType,
  getEvents,
  onClose,
}: TraceModalProps) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch events on mount
  useEffect(() => {
    let mounted = true;
    
    async function fetchEvents() {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getEvents(agentId);
        if (mounted) {
          setEvents(data);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load events");
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    
    fetchEvents();
    
    return () => {
      mounted = false;
    };
  }, [agentId, getEvents]);

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/90 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-4 md:inset-8 lg:inset-16 z-50 flex flex-col bg-black border border-white">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-[11px] uppercase tracking-widest text-white">
              TRACE
            </span>
            <span className="text-[10px] text-white/50">
              {agentType.toUpperCase()}
            </span>
            <span className="text-[9px] text-white/30 font-mono">
              {agentId.slice(0, 8)}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-[11px] transition-colors"
          >
            [ESC]
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-white/30 text-2xl mb-2 blink-hard">█</div>
                <p className="text-[10px] uppercase tracking-widest text-white/40">
                  LOADING EVENTS...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-red-400/70 text-2xl mb-2">✕</div>
                <p className="text-[10px] uppercase tracking-widest text-red-400/70">
                  {error}
                </p>
              </div>
            </div>
          ) : events.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-white/20 text-2xl mb-2">○</div>
                <p className="text-[10px] uppercase tracking-widest text-white/30">
                  NO EVENTS RECORDED
                </p>
              </div>
            </div>
          ) : (
            <TraceView events={events} />
          )}
        </div>
      </div>
    </>
  );
}

export default TraceModal;
