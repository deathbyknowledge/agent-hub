import { useState } from "react";
import { cn } from "../lib/utils";
import { Check, Clock, Warning, CaretDown, CaretRight } from "./Icons";

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
    icon: <Clock size={14} />,
    label: "Pending",
    color: "text-neutral-400"
  },
  in_progress: {
    icon: <Clock size={14} className="animate-pulse" />,
    label: "In Progress",
    color: "text-blue-500"
  },
  done: {
    icon: <Check size={14} />,
    label: "Done",
    color: "text-green-500"
  },
  blocked: {
    icon: <Warning size={14} />,
    label: "Blocked",
    color: "text-red-500"
  }
};

const PRIORITY_CONFIG: Record<TodoPriority, { label: string; color: string }> =
  {
    low: {
      label: "Low",
      color: "bg-neutral-100 dark:bg-neutral-800 text-neutral-500"
    },
    medium: {
      label: "Medium",
      color:
        "bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400"
    },
    high: {
      label: "High",
      color: "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
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
        "p-4 rounded-xl border transition-all",
        isDone
          ? "bg-neutral-50 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 opacity-60"
          : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          onClick={() => onToggle?.(todo.id)}
          className={cn(
            "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors",
            isDone
              ? "bg-green-500 border-green-500 text-white"
              : "border-neutral-300 dark:border-neutral-600 hover:border-green-500"
          )}
        >
          {isDone && <Check size={12} />}
        </button>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-medium text-neutral-900 dark:text-neutral-100",
                isDone && "line-through text-neutral-500"
              )}
            >
              {todo.title}
            </span>
            <span
              className={cn(
                "text-xs px-2 py-0.5 rounded-full",
                priorityConfig.color
              )}
            >
              {priorityConfig.label}
            </span>
          </div>

          {/* Description */}
          {todo.description && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">
              {todo.description}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className={cn("flex items-center gap-1", statusConfig.color)}>
              {statusConfig.icon}
              {statusConfig.label}
            </span>
            <span className="text-neutral-400">
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

  return (
    <div className="h-full overflow-y-auto">
      {/* Stats bar */}
      <div className="sticky top-0 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-500">
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              {stats.total}
            </span>{" "}
            total
          </span>
          <span className="text-neutral-500">
            <span className="font-medium text-green-500">{stats.done}</span>{" "}
            done
          </span>
          <span className="text-neutral-500">
            <span className="font-medium text-orange-500">{stats.active}</span>{" "}
            active
          </span>

          {/* Progress bar */}
          <div className="flex-1 max-w-xs">
            <div className="h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{
                  width: `${stats.total ? (stats.done / stats.total) * 100 : 0}%`
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {todos.length === 0 ? (
          <div className="text-center text-neutral-400 py-12">
            <p>No todos yet</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Active (pending + in_progress) */}
            {activeTodos.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-3">
                  Active ({activeTodos.length})
                </h3>
                <div className="space-y-2">
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
                  className="flex items-center gap-2 text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-3 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
                >
                  {showCompleted ? <CaretDown size={14} /> : <CaretRight size={14} />}
                  Completed ({completedTodos.length})
                </button>
                {showCompleted && (
                  <div className="space-y-2">
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
