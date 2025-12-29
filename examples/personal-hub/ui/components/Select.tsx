import { useState, useRef, useEffect } from "react";
import { cn } from "../lib/utils";

interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption?.label || placeholder || "[SELECT]";

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={cn(
          "w-full px-2 py-1.5 border border-white/50 bg-black text-xs uppercase tracking-wider text-left",
          "focus:outline-none focus:border-white transition-colors",
          "disabled:opacity-30 disabled:cursor-not-allowed",
          isOpen && "border-white",
          !selectedOption && "text-white/50",
          selectedOption && "text-white"
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate">{displayLabel}</span>
          <span className="text-white/50 text-[10px]">{isOpen ? "[-]" : "[+]"}</span>
        </span>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-px border border-white bg-black max-h-48 overflow-y-auto">
          {placeholder && !value && (
            <button
              type="button"
              className="w-full px-2 py-1.5 text-xs uppercase tracking-wider text-left text-white/30 border-b border-white/20"
              disabled
            >
              {placeholder}
            </button>
          )}
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              className={cn(
                "w-full px-2 py-1.5 text-xs uppercase tracking-wider text-left transition-colors",
                opt.value === value
                  ? "bg-white text-black"
                  : "text-white/70 hover:bg-white hover:text-black"
              )}
            >
              {opt.value === value && <span className="mr-1">&gt;</span>}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
