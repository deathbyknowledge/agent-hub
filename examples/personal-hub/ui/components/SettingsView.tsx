import { useState, useEffect } from "react";
import { cn } from "../lib/utils";
import { Button } from "./Button";
import { Select } from "./Select";
import { LayerCard, LayerCardContent, LayerCardFooter } from "./LayerCard";
import { ConfirmModal } from "./ConfirmModal";
import { BlueprintEditor } from "./BlueprintEditor";
import { FilesView } from "./FilesView";
import type {
  AgentBlueprint,
  AgentSchedule,
  ScheduleRun,
  CreateScheduleRequest,
  AgentScheduleType,
  PluginInfo,
  ToolInfo,
  VarHint
} from "agent-hub/client";

export interface MemoryDisk {
  name: string;
  description?: string;
  size?: number;
}

interface SettingsViewProps {
  agencyId: string | null;
  agencyName?: string;
  onMenuClick?: () => void;
  blueprints?: AgentBlueprint[];
  schedules?: AgentSchedule[];
  vars?: Record<string, unknown>;
  memoryDisks?: MemoryDisk[];
  onCreateSchedule?: (request: CreateScheduleRequest) => Promise<AgentSchedule>;
  onDeleteSchedule?: (id: string) => Promise<unknown>;
  onPauseSchedule?: (id: string) => Promise<unknown>;
  onResumeSchedule?: (id: string) => Promise<unknown>;
  onTriggerSchedule?: (id: string) => Promise<ScheduleRun>;
  onGetScheduleRuns?: (id: string) => Promise<ScheduleRun[]>;
  onRefreshSchedules?: () => Promise<unknown>;
  onSetVar?: (key: string, value: unknown) => Promise<unknown>;
  onDeleteVar?: (key: string) => Promise<unknown>;
  onCreateMemoryDisk?: (name: string, description?: string, entries?: string[]) => Promise<unknown>;
  onImportMemoryDisk?: (file: File) => Promise<unknown>;
  onDeleteMemoryDisk?: (name: string) => Promise<unknown>;
  onRefreshMemoryDisks?: () => Promise<unknown>;
  onCreateBlueprint?: (blueprint: Omit<AgentBlueprint, "createdAt" | "updatedAt">) => Promise<unknown>;
  onUpdateBlueprint?: (blueprint: AgentBlueprint) => Promise<unknown>;
  onDeleteBlueprint?: (name: string) => Promise<unknown>;
  onTestBlueprint?: (name: string) => Promise<unknown>;
  plugins?: PluginInfo[];
  tools?: ToolInfo[];
  // Filesystem
  listDirectory?: (path: string) => Promise<{ entries: { path: string; type: "file" | "dir"; size?: number; modified?: string }[] }>;
  readFile?: (path: string) => Promise<{ content: string }>;
  writeFile?: (path: string, content: string) => Promise<unknown>;
  deleteFile?: (path: string) => Promise<unknown>;
  onDeleteAgency?: () => void;
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
      return <span className="text-xs">[1x]</span>;
    case "cron":
      return <span className="text-xs">[CR]</span>;
    case "interval":
      return <span className="text-xs">[IV]</span>;
  }
}

// Status badge
function StatusBadge({ status }: { status: AgentSchedule["status"] }) {
  const styles = {
    active: "border-[#00ff00] text-[#00ff00]",
    paused: "border-[#ffaa00] text-[#ffaa00]",
    disabled: "border-white/30 text-white/30"
  };

  return (
    <span
      className={cn(
        "px-1 py-0.5 border text-[10px] uppercase tracking-wider",
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
        <span className="text-neutral-400 shrink-0 text-xs">
          {expanded ? "[-]" : "[+]"}
        </span>

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
            <span>
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
<span className="text-xs">[⚡]</span>
          </button>
          {schedule.status === "active" ? (
            <button
              onClick={onPause}
              className="p-1.5 rounded hover:bg-yellow-100 dark:hover:bg-yellow-900/50 text-neutral-400 hover:text-yellow-600 transition-colors"
              title="Pause"
            >
  <span className="text-xs">[||]</span>
            </button>
          ) : schedule.status === "paused" ? (
            <button
              onClick={onResume}
              className="p-1.5 rounded hover:bg-green-100 dark:hover:bg-green-900/50 text-neutral-400 hover:text-green-600 transition-colors"
              title="Resume"
            >
  <span className="text-xs">[▶]</span>
            </button>
          ) : null}
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/50 text-neutral-400 hover:text-red-600 transition-colors"
            title="Delete"
          >
<span className="text-xs">[X]</span>
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

    let runAtISO: string | undefined;
    if (type === "once" && runAt) {
      const localDate = new Date(runAt);
      runAtISO = localDate.toISOString();
    }

    onSubmit({
      name,
      agentType,
      type,
      cron: type === "cron" ? cron : undefined,
      intervalMs: type === "interval" ? intervalMs : undefined,
      runAt: runAtISO,
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

// Built-in runtime variables help dropdown
const BUILTIN_VARS = [
  { name: "LLM_API_KEY", description: "API key for the LLM provider", required: true },
  { name: "LLM_BASE_URL", description: "Base URL for the LLM API endpoint", required: false },
];

function BuiltInVarsHelp({ vars }: { vars: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="mt-4 pt-4 border-t border-white/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/50 hover:text-white/70 w-full"
      >
        <span>{expanded ? "[-]" : "[+]"}</span>
        <span>Runtime Variables</span>
        <span className="text-white/30 ml-auto">built-in overrides</span>
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-1">
          {BUILTIN_VARS.map((v) => {
            const isSet = v.name in vars;
            return (
              <div
                key={v.name}
                className="flex items-start gap-2 text-xs text-white/50"
              >
                <span className={cn("font-mono shrink-0", isSet && "text-[#00ff00]")}>
                  {isSet ? "[OK]" : v.required ? "[ ]" : "[·]"} {v.name}
                </span>
                <span className="text-white/30 truncate">— {v.description}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Plugin requirements dropdown
function PluginRequirementsDropdown({
  plugins,
  tools,
  vars
}: {
  plugins: PluginInfo[];
  tools: ToolInfo[];
  vars: Record<string, unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  
  const itemsWithHints = [
    ...plugins.filter(p => p.varHints?.length),
    ...tools.filter(t => t.varHints?.length)
  ];
  
  if (itemsWithHints.length === 0) return null;
  
  const totalMissing = itemsWithHints.reduce((acc, item) => {
    const hints = item.varHints ?? [];
    return acc + hints.filter((h: VarHint) => h.required && !(h.name in vars)).length;
  }, 0);
  
  return (
    <div className="mt-4 pt-4 border-t border-white/20">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-white/50 hover:text-white/70 w-full"
      >
        <span>{expanded ? "[-]" : "[+]"}</span>
        <span>Plugin Requirements</span>
        {totalMissing > 0 && (
          <span className="text-[#ff0000]">[!]</span>
        )}
        <span className="text-white/30 ml-auto">{itemsWithHints.length} plugins/tools</span>
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-2">
          {itemsWithHints.map((item) => {
            const hints = item.varHints ?? [];
            const missingRequired = hints.filter(
              (h: VarHint) => h.required && !(h.name in vars)
            );
            const hasMissing = missingRequired.length > 0;
            const itemType = tools.some(t => t.name === item.name) ? 'tool' : 'plugin';
            
            return (
              <div
                key={`${itemType}-${item.name}`}
                className={cn(
                  "p-2 border text-sm",
                  hasMissing
                    ? "border-[#ffaa00]/50 bg-[#ffaa00]/5"
                    : "border-white/20"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs text-white">
                    {item.name}
                  </span>
                  <span className="text-[10px] text-white/40 uppercase">{itemType}</span>
                  {hasMissing && (
                    <span className="text-[10px] text-[#ffaa00]">
                      [{missingRequired.length} MISSING]
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {hints.map((hint: VarHint) => {
                    const isSet = hint.name in vars;
                    const isMissing = hint.required && !isSet;
                    return (
                      <div
                        key={hint.name}
                        className={cn(
                          "flex items-start gap-2 text-xs",
                          isMissing ? "text-[#ffaa00]" : "text-white/50"
                        )}
                      >
                        <span className={cn(
                          "font-mono shrink-0",
                          isSet && "text-[#00ff00]"
                        )}>
                          {isSet ? "[OK]" : hint.required ? "[ ]" : "[·]"} {hint.name}
                        </span>
                        {hint.description && (
                          <span className="text-white/30 truncate">
                            — {hint.description}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
                    className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600"
                  >
                    <span className="text-xs">[OK]</span>
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
                      className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
                      title={showSecrets[key] ? "Hide" : "Show"}
                    >
                      <span className="text-xs">{showSecrets[key] ? "[*]" : "[O]"}</span>
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(key, value)}
                    className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400"
                    title="Edit"
                  >
                    <span className="text-xs">[E]</span>
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

// Memory Disks Editor
function MemoryDisksEditor({
  disks,
  onCreate,
  onImport,
  onDelete,
  onRefresh
}: {
  disks: MemoryDisk[];
  onCreate: (name: string, description?: string, entries?: string[]) => Promise<void>;
  onImport: (file: File) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newEntries, setNewEntries] = useState("");
  const [importing, setImporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const entries = newEntries
      .split("\n")
      .map((e) => e.trim())
      .filter(Boolean);
    await onCreate(newName.trim(), newDesc.trim() || undefined, entries.length ? entries : undefined);
    setNewName("");
    setNewDesc("");
    setNewEntries("");
    setShowCreate(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await onImport(file);
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-3">
      {disks.length === 0 && !showCreate ? (
        <p className="text-sm text-neutral-400 py-4 text-center">
          No memory disks. Create one to enable semantic search.
        </p>
      ) : (
        <div className="space-y-2">
          {disks.map((disk) => (
            <div
              key={disk.name}
              className="flex items-center gap-3 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700"
            >
              <span className="text-neutral-400 shrink-0 text-xs">[HD]</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-neutral-900 dark:text-neutral-100">
                  {disk.name}
                </div>
                {disk.description && (
                  <div className="text-xs text-neutral-500 truncate">
                    {disk.description}
                  </div>
                )}
              </div>
              {disk.size !== undefined && (
                <span className="text-xs text-neutral-400">
                  {disk.size} entries
                </span>
              )}
              {deleteConfirm === disk.name ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      onDelete(disk.name);
                      setDeleteConfirm(null);
                    }}
                    className="p-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600"
                    title="Confirm delete"
                  >
                    <span className="text-xs">[OK]</span>
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 text-xs"
                    title="Cancel"
                  >
                    [X]
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirm(disk.name)}
                  className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-600 text-xs"
                  title="Delete"
                >
                  [X]
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Disk name"
            className="w-full px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800"
            autoFocus
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800"
          />
          <textarea
            value={newEntries}
            onChange={(e) => setNewEntries(e.target.value)}
            placeholder="Initial entries (one per line, optional)"
            rows={3}
            className="w-full px-2 py-1.5 text-sm border border-neutral-300 dark:border-neutral-600 rounded-lg bg-white dark:bg-neutral-800 resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowCreate(false);
                setNewName("");
                setNewDesc("");
                setNewEntries("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      )}

      {!showCreate && (
        <div className="flex items-center gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-700">
          <Button
            variant="secondary"
            size="sm"
            icon={<span className="text-xs">[+]</span>}
            onClick={() => setShowCreate(true)}
          >
            New Disk
          </Button>
          <label
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer transition-colors",
              "border border-neutral-200 dark:border-neutral-700",
              "bg-white dark:bg-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-700",
              "text-neutral-700 dark:text-neutral-200",
              importing && "opacity-50 pointer-events-none"
            )}
          >
            <input
              type="file"
              accept=".idz,.json"
              onChange={handleImport}
              className="hidden"
              disabled={importing}
            />
            <span className="text-xs">[↑]</span>
            {importing ? "Importing..." : "Import"}
          </label>
        </div>
      )}
    </div>
  );
}

type SettingsTab = "blueprints" | "schedules" | "variables" | "memory" | "files";


export function SettingsView({
  agencyId,
  agencyName,
  onMenuClick,
  blueprints = [],
  schedules = [],
  vars = {},
  memoryDisks = [],
  onCreateSchedule,
  onDeleteSchedule,
  onPauseSchedule,
  onResumeSchedule,
  onTriggerSchedule,
  onGetScheduleRuns,
  onRefreshSchedules,
  onSetVar,
  onDeleteVar,
  onCreateMemoryDisk,
  onImportMemoryDisk,
  onDeleteMemoryDisk,
  onRefreshMemoryDisks,
  onCreateBlueprint,
  onUpdateBlueprint,
  onDeleteBlueprint,
  onTestBlueprint,
  plugins = [],
  tools = [],
  listDirectory,
  readFile,
  writeFile,
  deleteFile,
  onDeleteAgency,
}: SettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("blueprints");
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

  const tabs: { id: SettingsTab; label: string; color: string }[] = [
    { id: "blueprints", label: "[BPT]", color: "text-[#ffaa00]" },
    { id: "variables", label: "[VAR]", color: "text-[#00ff00]" },
    { id: "memory", label: "[MEM]", color: "text-[#00aaff]" },
    { id: "files", label: "[FS]", color: "text-white" },
    { id: "schedules", label: "[SCH]", color: "text-white/50" },
  ];

  return (
    <div className="h-full flex flex-col bg-black relative">
      {/* Tab Navigation */}
      <div className="border-b-2 border-white bg-black">
        <div className="flex items-center justify-between gap-2">
          <div className="flex overflow-x-auto scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "px-3 py-2 text-[11px] tracking-wider transition-colors whitespace-nowrap border-r border-white/20",
                  activeTab === tab.id
                    ? "bg-white text-black"
                    : cn(tab.color, "hover:text-black hover:bg-white")
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {onDeleteAgency && (
            <Button
              variant="danger"
              size="sm"
              icon={<span className="text-xs">[X]</span>}
              onClick={onDeleteAgency}
              className="mr-2"
            >
              Delete Agency
            </Button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6">
        {/* Variables Tab */}
        {activeTab === "variables" && (
      <LayerCard>
        <LayerCardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#00ff00]">[VAR]</span>
            <span className="text-[11px] uppercase tracking-wider text-white">
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
          {/* Built-in Runtime Variables Help */}
          <BuiltInVarsHelp vars={vars} />
          
          {/* Var hints from plugins and tools */}
          <PluginRequirementsDropdown plugins={plugins} tools={tools} vars={vars} />
        </LayerCardContent>
      </LayerCard>
        )}

        {/* Memory Tab */}
        {activeTab === "memory" && (
      <LayerCard>
        <LayerCardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#00aaff]">[MEM]</span>
            <span className="text-[11px] uppercase tracking-wider text-white">
              Memory
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<span className="text-xs">[↻]</span>}
            onClick={() => onRefreshMemoryDisks?.()}
          >
            Refresh
          </Button>
        </LayerCardFooter>
        <LayerCardContent>
          <MemoryDisksEditor
            disks={memoryDisks}
            onCreate={async (name, desc, entries) => {
              await onCreateMemoryDisk?.(name, desc, entries);
            }}
            onImport={async (file) => {
              await onImportMemoryDisk?.(file);
            }}
            onDelete={async (name) => {
              await onDeleteMemoryDisk?.(name);
            }}
            onRefresh={async () => {
              await onRefreshMemoryDisks?.();
            }}
          />
        </LayerCardContent>
      </LayerCard>
        )}

        {/* Files Tab */}
        {activeTab === "files" && (
      <LayerCard>
        <LayerCardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white">[FS]</span>
            <span className="text-[11px] uppercase tracking-wider text-white">
              Filesystem
            </span>
          </div>
        </LayerCardFooter>
        <LayerCardContent>
          <FilesView
            listDirectory={listDirectory}
            readFile={readFile}
            writeFile={writeFile}
            allowUpload
            showPathInput
            headerLabel="Filesystem"
          />
        </LayerCardContent>
      </LayerCard>
        )}

        {/* Blueprints Tab */}
        {activeTab === "blueprints" && (
      <LayerCard>
        <LayerCardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#ffaa00]">[BPT]</span>
            <span className="text-[11px] uppercase tracking-wider text-white">
              Agent Blueprints
            </span>
          </div>
        </LayerCardFooter>
        <LayerCardContent>
          <BlueprintEditor
            blueprints={blueprints}
            plugins={plugins}
            tools={tools}
            onCreateBlueprint={async (bp) => {
              await onCreateBlueprint?.(bp);
            }}
            onUpdateBlueprint={async (bp) => {
              await onUpdateBlueprint?.(bp);
            }}
            onDeleteBlueprint={async (name) => {
              await onDeleteBlueprint?.(name);
            }}
            onTestBlueprint={onTestBlueprint}
          />
        </LayerCardContent>
      </LayerCard>
        )}

        {/* Schedules Tab */}
        {activeTab === "schedules" && (
      <LayerCard>
        <LayerCardFooter className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white/50">[SCH]</span>
            <span className="text-[11px] uppercase tracking-wider text-white">
              Scheduled Runs
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            size="sm"
            icon={<span className="text-xs">[↻]</span>}
            onClick={() => onRefreshSchedules?.()}
          >
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<span className="text-xs">[+]</span>}
            onClick={() => setShowCreateForm(true)}
          >
            <span className="hidden sm:inline">New</span>
            <span className="sm:hidden">New</span>
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
            <div className="text-center py-8 text-white/50">
              <div className="text-xl mx-auto mb-2 opacity-50 font-mono">[--:--]</div>
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
        )}
      </div>

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
