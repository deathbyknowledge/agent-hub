/**
 * BottomPanel - Collapsible & resizable panel for Trace and Files views
 * 
 * Sits at the bottom of the chat view, can be expanded/collapsed.
 * When collapsed, shows a thin bar with tab buttons.
 * When expanded, shows the selected view (Trace or Files).
 * Drag the top edge to resize.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "../lib/utils";

type PanelTab = "trace" | "files";

const MIN_HEIGHT = 150;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 300;

interface BottomPanelProps {
  traceContent: React.ReactNode;
  filesContent: React.ReactNode;
  /** Initial expanded state */
  defaultExpanded?: boolean;
  /** Initial active tab */
  defaultTab?: PanelTab;
}

export function BottomPanel({
  traceContent,
  filesContent,
  defaultExpanded = false,
  defaultTab = "trace",
}: BottomPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeTab, setActiveTab] = useState<PanelTab>(defaultTab);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle tab click - expand if collapsed, or switch tab if already expanded
  const handleTabClick = useCallback((tab: PanelTab) => {
    if (!isExpanded) {
      setActiveTab(tab);
      setIsExpanded(true);
    } else if (activeTab === tab) {
      // Clicking active tab collapses
      setIsExpanded(false);
    } else {
      setActiveTab(tab);
    }
  }, [isExpanded, activeTab]);

  // Keyboard shortcut: Escape to collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  // Drag resize handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return;
      
      const parentRect = panelRef.current.parentElement?.getBoundingClientRect();
      if (!parentRect) return;
      
      // Calculate new height based on mouse position from bottom
      const newHeight = parentRect.bottom - e.clientY;
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, newHeight)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      ref={panelRef}
      className={cn(
        "flex flex-col border-t border-white/30 bg-black shrink-0",
        isDragging && "select-none"
      )}
      style={{ height: isExpanded ? height : "auto" }}
    >
      {/* Resize handle - only when expanded */}
      {isExpanded && (
        <div
          onMouseDown={handleDragStart}
          className={cn(
            "h-1 cursor-ns-resize group flex items-center justify-center",
            "hover:bg-white/10 transition-colors",
            isDragging && "bg-white/20"
          )}
        >
          <div className={cn(
            "w-12 h-0.5 bg-white/20 group-hover:bg-white/40 transition-colors",
            isDragging && "bg-white/60"
          )} />
        </div>
      )}

      {/* Tab bar - always visible */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-white/20 bg-black shrink-0">
        <div className="flex items-center gap-1">
          <TabButton
            active={activeTab === "trace" && isExpanded}
            onClick={() => handleTabClick("trace")}
          >
            <span className="text-[9px] mr-1">[~]</span>
            TRACE
          </TabButton>
          <TabButton
            active={activeTab === "files" && isExpanded}
            onClick={() => handleTabClick("files")}
          >
            <span className="text-[9px] mr-1">[/]</span>
            FILES
          </TabButton>
        </div>

        {/* Expand/collapse toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-white/40 hover:text-white transition-colors"
          title={isExpanded ? "Collapse panel (Esc)" : "Expand panel"}
        >
          {isExpanded ? (
            <>
              <span className="text-[8px]">▼</span>
              <span className="hidden sm:inline uppercase tracking-wider">COLLAPSE</span>
            </>
          ) : (
            <>
              <span className="text-[8px]">▲</span>
              <span className="hidden sm:inline uppercase tracking-wider">EXPAND</span>
            </>
          )}
        </button>
      </div>

      {/* Content area - only when expanded */}
      {isExpanded && (
        <div className="flex-1 overflow-hidden">
          <div className={cn("h-full", activeTab === "trace" ? "block" : "hidden")}>
            {traceContent}
          </div>
          <div className={cn("h-full", activeTab === "files" ? "block" : "hidden")}>
            {filesContent}
          </div>
        </div>
      )}
    </div>
  );
}

// Tab button component
function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center px-2 py-1 text-[10px] uppercase tracking-wider transition-colors",
        active
          ? "bg-white text-black"
          : "text-white/50 hover:text-white hover:bg-white/10"
      )}
    >
      {children}
    </button>
  );
}
