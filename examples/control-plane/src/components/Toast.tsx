import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { cn } from "../lib/utils";

// Toast types
type ToastType = "error" | "success" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  showError: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Duration before toast auto-dismisses (ms)
const TOAST_DURATION = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const showError = useCallback((message: string) => {
    showToast(message, "error");
  }, [showToast]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, showError }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

// Toast container renders at bottom-right of screen
function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, TOAST_DURATION - 300);

    const removeTimer = setTimeout(() => {
      onRemove(toast.id);
    }, TOAST_DURATION);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, onRemove]);

  const typeStyles: Record<ToastType, string> = {
    error: "bg-red-500/90 border-red-400 text-white",
    success: "bg-green-500/90 border-green-400 text-white",
    info: "bg-gray-800/90 border-gray-600 text-gray-100",
  };

  const typeIcons: Record<ToastType, string> = {
    error: "!",
    success: "\u2713",
    info: "i",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-sm",
        "transition-all duration-300 ease-out",
        typeStyles[toast.type],
        isExiting ? "opacity-0 translate-x-4" : "opacity-100 translate-x-0"
      )}
      role="alert"
    >
      <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/20 text-xs font-bold">
        {typeIcons[toast.type]}
      </span>
      <span className="text-sm leading-snug">{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 ml-auto text-white/60 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
