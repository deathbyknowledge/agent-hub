import { useState } from "react";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Select } from "./Select";
import { LayerCard, LayerCardContent, LayerCardFooter } from "./LayerCard";
import { ConfirmModal } from "./ConfirmModal";
import {
  Robot,
  Plus,
  Trash,
  Calendar,
  Clock,
  Play,
  Pause,
  Lightning,
  Timer,
  ArrowClockwise,
  CaretDown,
  CaretRight,
  Key,
  Eye,
  EyeSlash,
  Pencil,
  Check,
  X
} from "@phosphor-icons/react";
import type {
  AgentBlueprint,
  AgentSchedule,
  ScheduleRun,
  CreateScheduleRequest,
  AgentScheduleType
} from "@client";

interface SettingsViewProps {
  agencyId: string | null;
  agencyName?: string;
  blueprints?: AgentBlueprint[];
  schedules?: AgentSchedule[];
  vars?: Record<string, unknown>;
  onCreateSchedule?: (request: CreateScheduleRequest) => Promise<AgentSchedule>;
  onDeleteSchedule?: (id: string) => Promise<void>;
  onPauseSchedule?: (id: string) => Promise<void>;
  onResumeSchedule?: (id: string) => Promise<void>;
  onTriggerSchedule?: (id: string) => Promise<ScheduleRun>;
  onGetScheduleRuns?: (id: string) => Promise<ScheduleRun[]>;
  onRefreshSchedules?: () => Promise<void>;
  onSetVar?: (key: string, value: unknown) => Promise<void>;
  onDeleteVar?: (key: string) => Promise<void>;
}

// Format relative time
function formatRelativeTime(date: string): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = d.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffMs < 0) {
    const absMins = Math.abs(diffMins);
    const absHours = Math.abs(diffHours);
    const absDays = Math.abs(diffDays);
    if (absMins < 60) return `${absMins}m ago`;
    if (absHours < 24) return `${absHours}h ago`;
    return `${absDays}d ago`;
  } else {
    if (diffMins < 60) return `in ${diffMins}m`;
    if (diffHours < 24) return `in ${diffHours}h`;
    return `in ${diffDays}d`;
  }
}

// Schedule type icon
function ScheduleTypeIcon({ type }: { type: AgentScheduleType }) {
  switch (type) {
    case "once":
      return <Calendar size={14} />;
    case "cron":
      return <Clock size={14} />;
    case "interval":
      return <Timer size={14} />;
  }
}

// Status badge
function StatusBadge({ status }: { status: AgentSchedule["status"] }) {
  const styles = {
    active:
      "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    paused:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
    disabled:
      "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
  };

  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-xs font-medium",
        styles[status]
      )}
    >
      {status}
    </span>
  );
}

// Schedule row component
function ScheduleRow({
  schedule,
  blueprints,
  onPause,
  onResume,
  onTrigger,
  onDelete,
  onViewRuns
}: {
  schedule: AgentSchedule;
  blueprints: AgentBlueprint[];
  onPause: () => void;
  onResume: () => void;
  onTrigger: () => void;
  onDelete: () => void;
  onViewRuns: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const blueprint = blueprints.find((b) => b.name === schedule.agentType);

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div
        className="flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 bg-neutral-50 dark:bg-neutral-900 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <CaretDown size={14} className="text-neutral-400 shrink-0" />
        ) : (
          <CaretRight size={14} className="text-neutral-400 shrink-0" />
        )}

        <ScheduleTypeIcon type={schedule.type} />

        <div className="flex-1 min-w-0 basis-full sm:basis-auto order-last sm:order-none mt-2 sm:mt-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
              {schedule.name}
            </span>
            <StatusBadge status={schedule.status} />
          </div>
          <div className="flex items-center gap-2 sm:gap-3 text-xs text-neutral-500 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1">
              <Robot size={12} />
              {schedule.agentType}
            </span>
            {schedule.type === "cron" && schedule.cron && (
              <span className="font-mono">{schedule.cron}</span>
            )}
            {schedule.type === "interval" && schedule.intervalMs && (
              <span>{Math.round(schedule.intervalMs / 1000)}s interval</span>
            )}
            {schedule.type === "once" && schedule.runAt && (
              <span>{new Date(schedule.runAt).toLocaleString()}</span>
            )}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-4 text-xs text-neutral-500">
          {schedule.nextRunAt && (
            <span className="flex items-center gap-1">
              <Clock size={12} />
              Next: {formatRelativeTime(schedule.nextRunAt)}
            </span>
          )}
          {schedule.lastRunAt && (
            <span>Last: {formatRelativeTime(schedule.lastRunAt)}</span>
          )}
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onTrigger}
            className="p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
            title="Trigger now"
          >
            <Lightning size={16} />
          </button>
          {schedule.status === "active" ? (
            <button
              onClick={onPause}
              className="p-1.5 rounded hover:bg-yellow-100 dark:hover:bg-yellow-900/50 text-neutral-400 hover:text-yellow-600 transition-colors"
              title="Pause"
            >
              <Pause size={16} />
            </button>
          ) : schedule.status === "paused" ? (
            <button
              onClick={onResume}
              className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/50 text-neutral-400 hover:text-green-600 transition-colors"
              title="Resume"
            >
              <Play size={16} />
            </button>
          ) : null}
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-neutral-400 hover:text-red-600 transition-colors"
            title="Delete"
          >
            <Trash size={16} />
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-neutral-500 mb-1">Agent Type</div>
              <div className="font-medium text-neutral-900 dark:text-neutral-100">
                {schedule.agentType}
              </div>
              {blueprint?.description && (
                <div className="text-xs text-neutral-500 mt-0.5">
                  {blueprint.description}
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-1">
                Overlap Policy
              </div>
              <div className="font-medium text-neutral-900 dark:text-neutral-100 capitalize">
                {schedule.overlapPolicy}
              </div>
            </div>
            {schedule.input && (
              <div className="col-span-2">
                <div className="text-xs text-neutral-500 mb-1">Input</div>
                <pre className="text-xs bg-neutral-100 dark:bg-neutral-900 p-2 rounded overflow-auto max-h-32 text-neutral-800 dark:text-neutral-200">
                  {JSON.stringify(schedule.input, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">
            <Button variant="secondary" size="sm" onClick={onViewRuns}>
              View Run History
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Create schedule form
function CreateScheduleForm({
  blueprints,
  onSubmit,
  onCancel
}: {
  blueprints: AgentBlueprint[];
  onSubmit: (request: CreateScheduleRequest) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState(blueprints[0]?.name || "");
  const [type, setType] = useState<AgentScheduleType>("cron");
  const [cron, setCron] = useState("0 * * * *");
  const [intervalMs, setIntervalMs] = useState(3600000);
  const [runAt, setRunAt] = useState("");
  const [overlapPolicy, setOverlapPolicy] = useState<
    "skip" | "queue" | "allow"
  >("skip");
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    onSubmit({
      name,
      agentType,
      type,
      cron: type === "cron" ? cron : undefined,
      intervalMs: type === "interval" ? intervalMs : undefined,
      runAt: type === "once" ? runAt : undefined,
      overlapPolicy,
      input: message.trim() ? { message: message.trim() } : undefined
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          Schedule Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          placeholder="Daily report generation"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          Agent Type
        </label>
        <Select
          value={agentType}
          onChange={setAgentType}
          options={blueprints.map((bp) => ({
            label: bp.name,
            value: bp.name
          }))}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          Schedule Type
        </label>
        <div className="flex gap-2">
          {(["cron", "interval", "once"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "flex-1 px-3 py-2 rounded-lg border transition-colors capitalize flex items-center justify-center gap-2",
                type === t
                  ? "border-orange-500 bg-orange-50 dark:bg-orange-900/20 text-orange-600"
                  : "border-neutral-300 dark:border-neutral-600 hover:border-neutral-400 text-neutral-700 dark:text-neutral-300"
              )}
            >
              <ScheduleTypeIcon type={t} />
              <span>{t}</span>
            </button>
          ))}
        </div>
      </div>

      {type === "cron" && (
        <div>
          <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Cron Expression
          </label>
          <input
            type="text"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 font-mono"
            placeholder="0 * * * *"
            required
          />
          <p className="text-xs text-neutral-500 mt-1">
            e.g., "0 * * * *" (every hour), "0 9 * * 1-5" (9am weekdays)
          </p>
        </div>
      )}

      {type === "interval" && (
        <div>
          <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Interval (seconds)
          </label>
          <input
            type="number"
            value={intervalMs / 1000}
            onChange={(e) => setIntervalMs(Number(e.target.value) * 1000)}
            className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            min={60}
            required
          />
        </div>
      )}

      {type === "once" && (
        <div>
          <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
            Run At
          </label>
          <input
            type="datetime-local"
            value={runAt}
            onChange={(e) => setRunAt(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
            required
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          Overlap Policy
        </label>
        <Select
          value={overlapPolicy}
          onChange={(val) =>
            setOverlapPolicy(val as "skip" | "queue" | "allow")
          }
          options={[
            { label: "Skip", value: "skip" },
            { label: "Queue", value: "queue" },
            { label: "Allow parallel", value: "allow" }
          ]}
        />
        <p className="text-xs text-neutral-500 mt-1">
          {overlapPolicy === "skip" && "Don't run if previous still running"}
          {overlapPolicy === "queue" && "Wait for previous to finish"}
          {overlapPolicy === "allow" && "Run multiple instances in parallel"}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-1">
          Message (optional)
        </label>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
          placeholder="Generate the daily report"
        />
        <p className="text-xs text-neutral-500 mt-1">
          Initial message to send to the agent
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit">
          Create Schedule
        </Button>
      </div>
    </form>
  );
}

// Schedule runs modal
function ScheduleRunsModal({
  schedule,
  runs,
  onClose
}: {
  schedule: AgentSchedule;
  runs: ScheduleRun[];
  onClose: () => void;
}) {
  const statusColors: Record<ScheduleRun["status"], string> = {
    pending: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
    running:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
    skipped:
      "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
        <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">
              Run History
            </h3>
            <p className="text-sm text-neutral-500">{schedule.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            ×
          </button>
        </div>

        <div className="p-6 overflow-auto max-h-[60vh]">
          {runs.length === 0 ? (
            <p className="text-neutral-500 text-center py-8">No runs yet</p>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-3 px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg"
                >
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded text-xs font-medium",
                      statusColors[run.status]
                    )}
                  >
                    {run.status}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono text-neutral-900 dark:text-neutral-100 truncate">
                      {run.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-neutral-500">
                      Scheduled: {new Date(run.scheduledAt).toLocaleString()}
                    </div>
                  </div>
                  {run.agentId && (
                    <span className="text-xs font-mono text-neutral-500">
                      {run.agentId.slice(0, 8)}
                    </span>
                  )}
                  {run.error && (
                    <span className="text-xs text-red-500 truncate max-w-[200px]">
                      {run.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Vars editor component
function VarsEditor({
  vars,
  onSetVar,
  onDeleteVar
}: {
  vars: Record<string, unknown>;
  onSetVar: (key: string, value: unknown) => Promise<void>;
  onDeleteVar: (key: string) => Promise<void>;
}) {
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
              className="flex items-center gap-2 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
            >
              <Key size={14} className="text-neutral-400 shrink-0" />
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
                    className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600"
                  >
                    <Check size={14} />
                  </button>
                  <button
                    onClick={() => setEditingKey(null)}
                    className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
                  >
                    <X size={14} />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-mono text-sm text-neutral-500 truncate">
                    {displayValue(key, value)}
                  </span>
                  {isSecret(key) && (
                    <button
                      onClick={() =>
                        setShowSecrets((s) => ({ ...s, [key]: !s[key] }))
                      }
                      className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
                      title={showSecrets[key] ? "Hide" : "Show"}
                    >
                      {showSecrets[key] ? (
                        <EyeSlash size={14} />
                      ) : (
                        <Eye size={14} />
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(key, value)}
                    className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => onDeleteVar(key)}
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new var */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Key (e.g., OPENAI_API_KEY)"
          className="w-full sm:w-32 md:w-40 px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 font-mono"
        />
        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value"
          className="flex-1 px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={handleAdd}
          disabled={!newKey.trim()}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

export function SettingsView({
  agencyId,
  agencyName,
  blueprints = [],
  schedules = [],
  vars = {},
  onCreateSchedule,
  onDeleteSchedule,
  onPauseSchedule,
  onResumeSchedule,
  onTriggerSchedule,
  onGetScheduleRuns,
  onRefreshSchedules,
  onSetVar,
  onDeleteVar
}: SettingsViewProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedSchedule, setSelectedSchedule] =
    useState<AgentSchedule | null>(null);
  const [scheduleRuns, setScheduleRuns] = useState<ScheduleRun[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  if (!agencyId) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400">
        <p>Select an agency to view settings</p>
      </div>
    );
  }

  const handleCreateSchedule = async (request: CreateScheduleRequest) => {
    try {
      await onCreateSchedule?.(request);
      setShowCreateForm(false);
    } catch (err) {
      console.error("Failed to create schedule:", err);
    }
  };

  const handleViewRuns = async (schedule: AgentSchedule) => {
    if (onGetScheduleRuns) {
      const runs = await onGetScheduleRuns(schedule.id);
      setScheduleRuns(runs);
      setSelectedSchedule(schedule);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Agency Info */}
      <LayerCard>
        <LayerCardFooter>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            Agency Details
          </span>
        </LayerCardFooter>
        <LayerCardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <div className="text-xs text-neutral-500 mb-1">Name</div>
              <div className="font-medium text-neutral-900 dark:text-neutral-100">
                {agencyName || "Unnamed"}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-neutral-500 mb-1">ID</div>
              <div
                className="font-mono text-xs text-neutral-700 dark:text-neutral-300 truncate"
                title={agencyId}
              >
                {agencyId}
              </div>
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-1">Blueprints</div>
              <div className="text-sm text-neutral-700 dark:text-neutral-300">
                {blueprints.length} available
              </div>
            </div>
          </div>
        </LayerCardContent>
      </LayerCard>

      {/* Agency Vars */}
      <LayerCard>
        <LayerCardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key size={16} className="text-purple-500" />
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              Variables
            </span>
          </div>
        </LayerCardFooter>
        <LayerCardContent>
          <VarsEditor
            vars={vars}
            onSetVar={async (key, value) => {
              await onSetVar?.(key, value);
            }}
            onDeleteVar={async (key) => {
              await onDeleteVar?.(key);
            }}
          />
        </LayerCardContent>
      </LayerCard>

      {/* Blueprints List */}
      <LayerCard>
        <LayerCardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Robot size={16} className="text-orange-500" />
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              Agent Blueprints
            </span>
          </div>
        </LayerCardFooter>
        <LayerCardContent>
          {blueprints.length === 0 ? (
            <p className="text-sm text-neutral-400 py-4 text-center">
              No blueprints available.
            </p>
          ) : (
            <div className="space-y-2">
              {blueprints.map((bp) => (
                <div
                  key={bp.name}
                  className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
                >
                  <Robot size={18} className="text-neutral-400" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-neutral-900 dark:text-neutral-100">
                      {bp.name}
                    </div>
                    {bp.description && (
                      <div className="text-xs text-neutral-500 truncate">
                        {bp.description}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </LayerCardContent>
      </LayerCard>

      {/* Schedules */}
      <LayerCard>
        <LayerCardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-blue-500" />
            <span className="font-medium text-neutral-900 dark:text-neutral-100">
              Scheduled Runs
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowClockwise size={14} />}
              onClick={() => onRefreshSchedules?.()}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setShowCreateForm(true)}
            >
              New Schedule
            </Button>
          </div>
        </LayerCardFooter>
        <LayerCardContent>
          {showCreateForm ? (
            <CreateScheduleForm
              blueprints={blueprints}
              onSubmit={handleCreateSchedule}
              onCancel={() => setShowCreateForm(false)}
            />
          ) : schedules.length === 0 ? (
            <div className="text-center py-8 text-neutral-500">
              <Clock size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No schedules configured</p>
              <p className="text-xs mt-1">
                Create a schedule to run agents automatically
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map((schedule) => (
                <ScheduleRow
                  key={schedule.id}
                  schedule={schedule}
                  blueprints={blueprints}
                  onPause={() => onPauseSchedule?.(schedule.id)}
                  onResume={() => onResumeSchedule?.(schedule.id)}
                  onTrigger={() => onTriggerSchedule?.(schedule.id)}
                  onDelete={() => setDeleteConfirm({ id: schedule.id, name: schedule.name })}
                  onViewRuns={() => handleViewRuns(schedule)}
                />
              ))}
            </div>
          )}
        </LayerCardContent>
      </LayerCard>

      {/* Schedule Runs Modal */}
      {selectedSchedule && (
        <ScheduleRunsModal
          schedule={selectedSchedule}
          runs={scheduleRuns}
          onClose={() => setSelectedSchedule(null)}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <ConfirmModal
          title="Delete Schedule"
          message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => {
            onDeleteSchedule?.(deleteConfirm.id);
            setDeleteConfirm(null);
          }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}
