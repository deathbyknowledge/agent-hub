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
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700",
        "bg-white dark:bg-neutral-900 text-sm text-neutral-900 dark:text-neutral-100",
        "focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        !value && placeholder && "text-neutral-500",
        className
      )}
    >
      {placeholder && (
        <option value="" disabled={!value}>
          {placeholder}
        </option>
      )}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
