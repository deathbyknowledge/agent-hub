import { useState } from "react";
import { cn } from "../lib/utils";
import { Check, Clock, Warning } from "@phosphor-icons/react";

// Types
type TodoStatus = "pending" | "in_progress" | "done" | "blocked";
type TodoPriority = "low" | "medium" | "high";

interface Todo {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority: TodoPriority;
  createdAt: string;
  completedAt?: string;
}

interface TodosViewProps {
  todos: Todo[];
  onToggle?: (id: string) => void;
}

const STATUS_CONFIG: Record<
  TodoStatus,
  { icon: React.ReactNode; label: string; color: string }
> = {
  pending: {
    icon: <Clock size={10} />,
    label: "PENDING",
    color: "text-white/40"
  },
  in_progress: {
    icon: <Clock size={10} className="animate-pulse" />,
    label: "EXEC",
    color: "text-[#00aaff]"
  },
  done: {
    icon: <Check size={10} />,
    label: "DONE",
    color: "text-[#00ff00]"
  },
  blocked: {
    icon: <Warning size={10} />,
    label: "BLOCKED",
    color: "text-[#ff0000]"
  }
};

const PRIORITY_CONFIG: Record<TodoPriority, { label: string; color: string }> =
  {
    low: {
      label: "LOW",
      color: "border-white/20 text-white/40"
    },
    medium: {
      label: "MED",
      color: "border-[#ffaa00]/50 text-[#ffaa00]"
    },
    high: {
      label: "HIGH",
      color: "border-[#ff0000]/50 text-[#ff0000]"
    }
  };

function TodoCard({
  todo,
  onToggle
}: {
  todo: Todo;
  onToggle?: (id: string) => void;
}) {
  const statusConfig = STATUS_CONFIG[todo.status];
  const priorityConfig = PRIORITY_CONFIG[todo.priority];
  const isDone = todo.status === "done";

  return (
    <div
      className={cn(
        "p-3 border transition-all bg-black",
        isDone
          ? "border-white/10 opacity-50"
          : "border-white/30"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggle?.(todo.id)}
          className={cn(
            "w-4 h-4 border flex items-center justify-center shrink-0 mt-0.5 transition-colors",
            isDone
              ? "bg-[#00ff00] border-[#00ff00] text-black"
              : "border-white/50 hover:border-white"
          )}
        >
          {isDone && <Check size={10} />}
        </button>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[11px] uppercase tracking-wider text-white",
                isDone && "line-through text-white/40"
              )}
            >
              {todo.title}
            </span>
            <span
              className={cn(
                "text-[10px] px-1 py-0.5 border uppercase tracking-wider",
                priorityConfig.color
              )}
            >
              {priorityConfig.label}
            </span>
          </div>

          {/* Description */}
          {todo.description && (
            <p className="text-[10px] text-white/50 mt-1">
              {todo.description}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center gap-3 mt-2 text-[10px]">
            <span className={cn("flex items-center gap-1 uppercase tracking-wider", statusConfig.color)}>
              {statusConfig.icon}
              {statusConfig.label}
            </span>
            <span className="text-white/30 font-mono">
              {new Date(todo.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TodosView({ todos, onToggle }: TodosViewProps) {
  const [showCompleted, setShowCompleted] = useState(false);
  
  const activeTodos = todos.filter((t) => t.status !== "done");
  const completedTodos = todos.filter((t) => t.status === "done");

  const stats = {
    total: todos.length,
    done: completedTodos.length,
    active: activeTodos.length
  };

  const progressPercent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto bg-black">
      {/* Stats bar */}
      <div className="sticky top-0 bg-black border-b-2 border-white px-3 py-2">
        <div className="flex items-center gap-4 text-[10px] uppercase tracking-wider flex-wrap">
          <span className="text-white/50">
            TOTAL: <span className="text-white">{stats.total}</span>
          </span>
          <span className="text-white/50">
            DONE: <span className="text-[#00ff00]">{stats.done}</span>
          </span>
          <span className="text-white/50">
            ACTIVE: <span className="text-[#ffaa00]">{stats.active}</span>
          </span>

          {/* Progress bar */}
          <div className="flex-1 max-w-xs min-w-0 flex items-center gap-2">
            <div className="flex-1 h-1 bg-white/10 overflow-hidden">
              <div
                className="h-full bg-[#00ff00] transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-white/30 font-mono">[{progressPercent}%]</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {todos.length === 0 ? (
          <div className="text-center text-[10px] uppercase tracking-widest text-white/30 py-12 border border-dashed border-white/20">
            // NO TASKS QUEUED
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active (pending + in_progress) */}
            {activeTodos.length > 0 && (
              <div>
                <h3 className="text-[10px] uppercase tracking-widest text-white/50 mb-2 border-b border-white/20 pb-1">
                  ACTIVE [{activeTodos.length}]
                </h3>
                <div className="space-y-1">
                  {activeTodos.map((todo) => (
                    <TodoCard key={todo.id} todo={todo} onToggle={onToggle} />
                  ))}
                </div>
              </div>
            )}

            {/* Completed - collapsible */}
            {completedTodos.length > 0 && (
              <div>
                <button
                  onClick={() => setShowCompleted(!showCompleted)}
                  className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/30 mb-2 hover:text-black hover:bg-white transition-colors border-b border-white/10 pb-1 w-full"
                >
                  <span>{showCompleted ? "[-]" : "[+]"}</span>
                  COMPLETED [{completedTodos.length}]
                </button>
                {showCompleted && (
                  <div className="space-y-1">
                    {completedTodos.map((todo) => (
                      <TodoCard key={todo.id} todo={todo} onToggle={onToggle} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export type { Todo, TodoStatus, TodoPriority };
