import { useState } from "react";
import { Button } from "./Button";

interface VarEditorProps {
  vars: Record<string, unknown>;
  onSetVar: (key: string, value: unknown) => Promise<void>;
  onDeleteVar: (key: string) => Promise<void>;
}

export function VarEditor({ vars, onSetVar, onDeleteVar }: VarEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const entries = Object.entries(vars);
  const isSecret = (key: string) =>
    key.toLowerCase().includes("key") ||
    key.toLowerCase().includes("secret") ||
    key.toLowerCase().includes("token") ||
    key.toLowerCase().includes("password");

  const handleAdd = async () => {
    if (!newKey.trim()) return;
    try {
      const parsed =
        newValue.startsWith("{") || newValue.startsWith("[")
          ? JSON.parse(newValue)
          : newValue;
      await onSetVar(newKey.trim(), parsed);
      setNewKey("");
      setNewValue("");
    } catch {
      await onSetVar(newKey.trim(), newValue);
      setNewKey("");
      setNewValue("");
    }
  };

  const handleEdit = async (key: string) => {
    try {
      const parsed =
        editValue.startsWith("{") || editValue.startsWith("[")
          ? JSON.parse(editValue)
          : editValue;
      await onSetVar(key, parsed);
      setEditingKey(null);
    } catch {
      await onSetVar(key, editValue);
      setEditingKey(null);
    }
  };

  const startEdit = (key: string, value: unknown) => {
    setEditingKey(key);
    setEditValue(
      typeof value === "string" ? value : JSON.stringify(value, null, 2)
    );
  };

  const displayValue = (key: string, value: unknown): string => {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    if (isSecret(key) && !showSecrets[key]) {
      return "•".repeat(Math.min(str.length, 20));
    }
    return str;
  };

  return (
    <div className="space-y-3">
      {entries.length === 0 ? (
        <p className="text-sm text-neutral-400 py-4 text-center">
          No variables configured. Add API keys, tool configs, etc.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="flex items-center gap-2 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden"
            >
              <span className="font-mono text-sm text-neutral-700 dark:text-neutral-300 min-w-0 sm:min-w-[100px] truncate">
                {key}
              </span>

              {editingKey === key ? (
                <>
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border border-neutral-300 dark:border-neutral-600 rounded bg-white dark:bg-neutral-800 font-mono"
                    autoFocus
                  />
                  <button
                    onClick={() => handleEdit(key)}
                    className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 text-xs"
                  >
                    [OK]
                  </button>
                  <button
                    onClick={() => setEditingKey(null)}
                    className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 text-xs"
                  >
                    [X]
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 font-mono text-sm text-neutral-500 truncate">
                    {displayValue(key, value)}
                  </span>
                  {isSecret(key) && (
                    <button
                      onClick={() =>
                        setShowSecrets((s) => ({ ...s, [key]: !s[key] }))
                      }
                      className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 text-xs"
                      title={showSecrets[key] ? "Hide" : "Show"}
                    >
                      {showSecrets[key] ? "[*]" : "[O]"}
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(key, value)}
                    className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 text-xs"
                    title="Edit"
                  >
                    [E]
                  </button>
                  <button
                    onClick={() => onDeleteVar(key)}
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-600 text-xs"
                    title="Delete"
                  >
                    [X]
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Variable name"
          className="flex-1 px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 font-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newKey.trim()) {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value (string or JSON)"
          className="flex-1 px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 font-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newKey.trim()) {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          icon={<span className="text-xs">[+]</span>}
          onClick={handleAdd}
          disabled={!newKey.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}
