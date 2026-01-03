/**
 * CommandInput - Input with @mention autocomplete
 * 
 * Supports:
 * - @mention autocomplete with filtering
 * - Ctrl+P / Ctrl+N for navigation (vim style)
 * - Arrow keys for navigation
 * - Tab/Enter to select
 * - Escape to close
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "../../lib/utils";

interface MentionTarget {
  id: string;
  label: string;
  type: "mind" | "agent" | "blueprint";
}

interface CommandInputProps {
  targets: MentionTarget[];
  defaultTarget?: string;
  onSubmit: (target: string, message: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
}

export function CommandInput({
  targets,
  defaultTarget = "_agency-mind",
  onSubmit,
  disabled = false,
  placeholder = "Type a command...",
}: CommandInputProps) {
  const [value, setValue] = useState("");
  const [selectedTarget, setSelectedTarget] = useState(defaultTarget);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const mentionStartRef = useRef<number | null>(null);

  // Filter targets based on current mention filter
  const filteredTargets = mentionFilter
    ? targets.filter((t) =>
        t.label.toLowerCase().includes(mentionFilter.toLowerCase())
      )
    : targets;

  // Reset mention index when filter changes, clamp to valid range
  useEffect(() => {
    setMentionIndex(0);
  }, [mentionFilter]);

  // Scroll selected item into view
  useEffect(() => {
    if (showMentions && mentionListRef.current) {
      const items = mentionListRef.current.querySelectorAll("[data-mention-item]");
      const selectedItem = items[mentionIndex] as HTMLElement | undefined;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" });
      }
    }
  }, [mentionIndex, showMentions]);

  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Check for @ mention
    const cursorPos = e.target.selectionStart || 0;
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Only show mentions if no space after @
      if (!textAfterAt.includes(" ")) {
        mentionStartRef.current = lastAtIndex;
        setMentionFilter(textAfterAt);
        setShowMentions(true);
        return;
      }
    }

    setShowMentions(false);
    mentionStartRef.current = null;
  };

  // Handle mention selection
  const selectMention = useCallback(
    (target: MentionTarget) => {
      if (mentionStartRef.current === null) return;

      const beforeMention = value.slice(0, mentionStartRef.current);
      const cursorPos = inputRef.current?.selectionStart || value.length;
      const afterMention = value.slice(cursorPos);

      // Set target and remove @mention from input
      setSelectedTarget(target.id);
      setValue(beforeMention + afterMention);

      setShowMentions(false);
      mentionStartRef.current = null;
      setMentionIndex(0);
      inputRef.current?.focus();
    },
    [value]
  );

  // Handle key events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showMentions && filteredTargets.length > 0) {
      // Ctrl+N or Arrow Down - next item
      if ((e.ctrlKey && e.key === "n") || e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredTargets.length);
        return;
      }
      // Ctrl+P or Arrow Up - previous item
      if ((e.ctrlKey && e.key === "p") || e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredTargets.length) % filteredTargets.length);
        return;
      }
      // Tab or Enter - select
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        selectMention(filteredTargets[mentionIndex]);
        return;
      }
      // Escape - close
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMentions(false);
        return;
      }
    }

    // Submit on Enter (when not in mention mode)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Handle submit
  const handleSubmit = async () => {
    const message = value.trim();
    if (!message || disabled || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(selectedTarget, message);
      setValue("");
    } catch (err) {
      console.error("Failed to submit:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Get display label for selected target
  const getTargetLabel = () => {
    const target = targets.find((t) => t.id === selectedTarget);
    if (target) return target.label;
    if (selectedTarget === "_agency-mind") return "agency-mind";
    return selectedTarget;
  };

  const targetLabel = getTargetLabel();
  const isNewAgent = selectedTarget.startsWith("new:");

  return (
    <div className="relative border-t border-white bg-black">
      {/* Mention dropdown */}
      {showMentions && filteredTargets.length > 0 && (
        <div 
          ref={mentionListRef}
          className="absolute bottom-full left-0 right-0 mb-0 bg-black border border-white/30 max-h-48 overflow-y-auto"
        >
          {filteredTargets.map((target, i) => {
            // Extract short ID for agents (not blueprints/minds)
            const shortId = target.type === "agent" ? target.id.slice(0, 6) : null;
            
            return (
              <button
                key={target.id}
                data-mention-item
                onClick={() => selectMention(target)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors",
                  i === mentionIndex
                    ? "bg-white text-black"
                    : "text-white/70 hover:bg-white/10"
                )}
              >
                <span
                  className={cn(
                    "w-4 text-center",
                    i === mentionIndex ? "text-black" : "text-white/40"
                  )}
                >
                  {target.type === "mind" && "◆"}
                  {target.type === "agent" && "●"}
                  {target.type === "blueprint" && "+"}
                </span>
                <span className="uppercase tracking-wide">{target.label}</span>
                {shortId && (
                  <span className={cn(
                    "text-[9px] font-mono",
                    i === mentionIndex ? "text-black/40" : "text-white/25"
                  )}>
                    {shortId}
                  </span>
                )}
                <span className="flex-1" />
                <span className={cn(
                  "text-[9px]",
                  i === mentionIndex ? "text-black/50" : "text-white/30"
                )}>
                  {target.type}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-center">
        {/* Target indicator */}
        <div
          className={cn(
            "px-3 py-2 text-[10px] uppercase tracking-wider border-r border-white/20 shrink-0",
            isNewAgent ? "text-amber-400/70" : "text-white/50"
          )}
        >
          @{targetLabel}
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSubmitting}
          placeholder={placeholder}
          className={cn(
            "flex-1 px-3 py-2 bg-transparent text-white text-[12px]",
            "placeholder:text-white/30 placeholder:uppercase placeholder:tracking-wider",
            "focus:outline-none",
            "disabled:opacity-30"
          )}
        />

        {/* Submit button */}
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || disabled || isSubmitting}
          className={cn(
            "px-4 py-2 text-[11px] uppercase tracking-wider border-l border-white/20 transition-colors",
            "disabled:opacity-30 disabled:cursor-not-allowed",
            isSubmitting
              ? "text-sky-400/70 blink-hard"
              : "text-white/50 hover:text-white hover:bg-white/5"
          )}
        >
          {isSubmitting ? "..." : "[SEND]"}
        </button>
      </div>
    </div>
  );
}

export default CommandInput;
