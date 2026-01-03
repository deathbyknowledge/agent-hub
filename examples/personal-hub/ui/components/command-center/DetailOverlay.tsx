/**
 * DetailOverlay - Modal overlay for agent details, blueprints, schedules, settings
 * 
 * Provides full functionality for viewing/editing within the CommandCenter layout.
 */
import { useState, useMemo, useCallback } from "react";
import { cn } from "../../lib/utils";
import { ChatView, type Message } from "../ChatView";
import { useAgent, useAgency, usePlugins } from "../../hooks";
import type { AgentBlueprint, ChatMessage, ToolCall as APIToolCall } from "agent-hub/client";

// Convert ChatMessage[] to Message[] (same as in App.tsx)
function convertChatMessages(apiMessages: ChatMessage[]): Message[] {
  const messages: Message[] = [];
  const toolResults = new Map<string, { content: string; status: "done" | "error" }>();

  for (const msg of apiMessages) {
    if (msg.role === "tool") {
      const toolMsg = msg as { role: "tool"; content: string; toolCallId: string };
      toolResults.set(toolMsg.toolCallId, { content: toolMsg.content, status: "done" });
    }
  }

  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i];
    const timestamp = msg.ts || "";

    if (msg.role === "tool") continue;

    if (msg.role === "assistant") {
      const assistantMsg = msg as
        | { role: "assistant"; content: string; reasoning?: string; ts?: string }
        | { role: "assistant"; toolCalls?: APIToolCall[]; reasoning?: string; ts?: string };

      const reasoning = "reasoning" in assistantMsg ? assistantMsg.reasoning : undefined;

      if ("toolCalls" in assistantMsg && assistantMsg.toolCalls?.length) {
        const toolCalls = assistantMsg.toolCalls.map((tc) => {
          const result = toolResults.get(tc.id);
          return {
            id: tc.id,
            name: tc.name,
            args: tc.args as Record<string, unknown>,
            result: result?.content,
            status: result ? result.status : ("running" as const),
          };
        });

        const content = "content" in assistantMsg ? (assistantMsg as { content?: string }).content || "" : "";
        messages.push({ id: `msg-${i}`, role: "assistant", content, timestamp, toolCalls, reasoning });
      } else if ("content" in assistantMsg && assistantMsg.content) {
        messages.push({ id: `msg-${i}`, role: "assistant", content: assistantMsg.content, timestamp, reasoning });
      }
    } else {
      const contentMsg = msg as { role: "user" | "system"; content: string };
      messages.push({ id: `msg-${i}`, role: contentMsg.role, content: contentMsg.content || "", timestamp });
    }
  }

  return messages;
}

type OverlayData =
  | { type: "agent"; agentId: string }
  | { type: "blueprint"; name?: string }
  | { type: "schedule"; id?: string }
  | { type: "settings" };

interface DetailOverlayProps {
  type: "agent" | "blueprint" | "schedule" | "settings";
  data: OverlayData;
  agencyId: string;
  onClose: () => void;
  onNavigateToAgent?: (agentId: string) => void;
}

export function DetailOverlay({
  type,
  data,
  agencyId,
  onClose,
  onNavigateToAgent,
}: DetailOverlayProps) {
  const getTitle = () => {
    switch (type) {
      case "agent":
        return "AGENT_TERMINAL";
      case "blueprint":
        return (data as { name?: string }).name ? "EDIT_BLUEPRINT" : "SELECT_BLUEPRINT";
      case "schedule":
        return (data as { id?: string }).id ? "VIEW_SCHEDULE" : "NEW_SCHEDULE";
      case "settings":
        return "AGENCY_CONFIG";
      default:
        return "DETAIL";
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/80 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-2xl bg-black border-l border-white z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white shrink-0">
          <h2 className="text-[11px] uppercase tracking-widest text-white">{getTitle()}</h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-[11px] transition-colors"
          >
            [X]
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {type === "agent" && (
            <AgentDetail
              agencyId={agencyId}
              agentId={(data as { agentId: string }).agentId}
            />
          )}
          {type === "blueprint" && (
            <BlueprintPicker
              agencyId={agencyId}
              onSelect={(name) => {
                onNavigateToAgent?.(name);
                onClose();
              }}
              onClose={onClose}
            />
          )}
          {type === "schedule" && (
            <SchedulePanel
              agencyId={agencyId}
              id={(data as { id?: string }).id}
              onClose={onClose}
            />
          )}
          {type === "settings" && (
            <SettingsPanel agencyId={agencyId} onClose={onClose} />
          )}
        </div>
      </div>
    </>
  );
}

// Agent Detail - Shows conversation with ChatView
function AgentDetail({
  agencyId,
  agentId,
}: {
  agencyId: string;
  agentId: string;
}) {
  const { agents } = useAgency(agencyId);
  const { state, run, sendMessage, cancel, loading } = useAgent(agencyId, agentId);

  const agent = agents.find((a) => a.id === agentId);
  const messages = useMemo(() => convertChatMessages(state?.messages || []), [state?.messages]);

  const handleSend = useCallback(async (content: string) => {
    await sendMessage(content);
  }, [sendMessage]);

  return (
    <div className="flex flex-col h-full">
      {/* Agent info header */}
      <div className="px-4 py-2 border-b border-white/20 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] uppercase tracking-wider text-white">
              {agent?.agentType || "AGENT"}
            </span>
            <span className="text-[10px] text-white/30 font-mono ml-2">
              {agentId.slice(0, 8)}
            </span>
          </div>
          {run?.status === "running" && (
            <span className="text-[10px] text-sky-400/70 blink-hard">RUNNING</span>
          )}
        </div>
      </div>

      {/* Chat view */}
      <div className="flex-1 overflow-hidden">
        <ChatView
          messages={messages}
          onSendMessage={handleSend}
          onStop={cancel}
          isLoading={loading || run?.status === "running"}
        />
      </div>
    </div>
  );
}

// Blueprint Picker - Simpler than full editor, just pick and spawn
function BlueprintPicker({
  agencyId,
  onSelect,
  onClose,
}: {
  agencyId: string;
  onSelect: (agentId: string) => void;
  onClose: () => void;
}) {
  const { blueprints, spawnAgent } = useAgency(agencyId);
  const [isSpawning, setIsSpawning] = useState<string | null>(null);

  const visibleBlueprints = blueprints.filter((b) => !b.name.startsWith("_"));

  const handleSpawn = async (name: string) => {
    setIsSpawning(name);
    try {
      const agent = await spawnAgent(name);
      onSelect(agent.id);
    } catch (err) {
      console.error("Failed to spawn agent:", err);
    } finally {
      setIsSpawning(null);
    }
  };

  return (
    <div className="p-4 space-y-2 overflow-y-auto">
      {visibleBlueprints.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-[10px] uppercase tracking-widest text-white/30">
            NO BLUEPRINTS AVAILABLE
          </p>
          <p className="text-[10px] text-white/20 mt-2">
            Create blueprints in Agency Settings
          </p>
        </div>
      ) : (
        visibleBlueprints.map((bp) => (
          <button
            key={bp.name}
            onClick={() => handleSpawn(bp.name)}
            disabled={isSpawning !== null}
            className={cn(
              "w-full text-left p-3 border border-white/20 hover:border-white hover:bg-white/5 transition-colors",
              isSpawning === bp.name && "border-sky-400/50 bg-sky-400/10"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider text-white">
                {bp.name}
              </span>
              {isSpawning === bp.name && (
                <span className="text-[10px] text-sky-400/70 blink-hard">
                  SPAWNING...
                </span>
              )}
            </div>
            {bp.description && (
              <p className="text-[10px] text-white/50 mt-1">{bp.description}</p>
            )}
            {bp.capabilities && bp.capabilities.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {bp.capabilities.slice(0, 5).map((cap) => (
                  <span
                    key={cap}
                    className="text-[9px] text-white/30 border border-white/10 px-1.5 py-0.5"
                  >
                    {cap}
                  </span>
                ))}
                {bp.capabilities.length > 5 && (
                  <span className="text-[9px] text-white/20">
                    +{bp.capabilities.length - 5}
                  </span>
                )}
              </div>
            )}
          </button>
        ))
      )}
    </div>
  );
}

// Schedule Panel - View/create schedules
function SchedulePanel({
  agencyId,
  id,
  onClose,
}: {
  agencyId: string;
  id?: string;
  onClose: () => void;
}) {
  const { schedules, blueprints, createSchedule, deleteSchedule, pauseSchedule, resumeSchedule } = useAgency(agencyId);
  const schedule = id ? schedules.find((s) => s.id === id) : undefined;

  const [agentType, setAgentType] = useState(schedule?.agentType || "");
  const [scheduleType, setScheduleType] = useState<"once" | "cron" | "interval">(schedule?.type || "cron");
  const [scheduleName, setScheduleName] = useState(schedule?.name || "");
  const [cronPattern, setCronPattern] = useState(schedule?.cron || "0 9 * * *");
  const [intervalMs, setIntervalMs] = useState(String(schedule?.intervalMs || 60000));
  const [scheduledTime, setScheduledTime] = useState("");

  const handleSave = async () => {
    if (!scheduleName.trim() || !agentType) return;

    const base = {
      name: scheduleName.trim(),
      agentType,
    };

    try {
      if (scheduleType === "once") {
        await createSchedule({ ...base, type: "once", runAt: new Date(scheduledTime).toISOString() });
      } else if (scheduleType === "cron") {
        await createSchedule({ ...base, type: "cron", cron: cronPattern });
      } else {
        await createSchedule({ ...base, type: "interval", intervalMs: parseInt(intervalMs, 10) });
      }
      onClose();
    } catch (err) {
      console.error("Failed to create schedule:", err);
    }
  };

  const handleDelete = async () => {
    if (id) {
      await deleteSchedule(id);
      onClose();
    }
  };

  const handleTogglePause = async () => {
    if (!schedule) return;
    if (schedule.status === "paused") {
      await resumeSchedule(schedule.id);
    } else {
      await pauseSchedule(schedule.id);
    }
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      {/* Name */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-1">
          NAME
        </label>
        <input
          type="text"
          value={scheduleName}
          onChange={(e) => setScheduleName(e.target.value)}
          placeholder="my-schedule"
          disabled={!!schedule}
          className="w-full px-3 py-2 bg-black border border-white/30 text-white text-[11px] focus:outline-none focus:border-white disabled:opacity-50"
        />
      </div>

      {/* Blueprint */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-1">
          BLUEPRINT
        </label>
        <select
          value={agentType}
          onChange={(e) => setAgentType(e.target.value)}
          disabled={!!schedule}
          className="w-full px-3 py-2 bg-black border border-white/30 text-white text-[11px] focus:outline-none focus:border-white disabled:opacity-50"
        >
          <option value="">Select blueprint...</option>
          {blueprints.filter((b) => !b.name.startsWith("_")).map((b) => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
      </div>

      {/* Type */}
      {!schedule && (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-1">
            TYPE
          </label>
          <div className="flex gap-2">
            {(["once", "cron", "interval"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setScheduleType(t)}
                className={cn(
                  "px-3 py-1.5 text-[10px] uppercase tracking-wider border transition-colors",
                  scheduleType === t
                    ? "border-white bg-white text-black"
                    : "border-white/30 text-white/60 hover:border-white hover:text-white"
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Type-specific fields */}
      {!schedule && scheduleType === "once" && (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-1">
            SCHEDULED TIME
          </label>
          <input
            type="datetime-local"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            className="w-full px-3 py-2 bg-black border border-white/30 text-white text-[11px] focus:outline-none focus:border-white"
          />
        </div>
      )}

      {!schedule && scheduleType === "cron" && (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-1">
            CRON PATTERN
          </label>
          <input
            type="text"
            value={cronPattern}
            onChange={(e) => setCronPattern(e.target.value)}
            placeholder="0 9 * * *"
            className="w-full px-3 py-2 bg-black border border-white/30 text-white text-[11px] font-mono focus:outline-none focus:border-white"
          />
          <p className="text-[9px] text-white/30 mt-1">
            minute hour day-of-month month day-of-week
          </p>
        </div>
      )}

      {!schedule && scheduleType === "interval" && (
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-1">
            INTERVAL (MS)
          </label>
          <input
            type="number"
            value={intervalMs}
            onChange={(e) => setIntervalMs(e.target.value)}
            min="1000"
            step="1000"
            className="w-full px-3 py-2 bg-black border border-white/30 text-white text-[11px] font-mono focus:outline-none focus:border-white"
          />
        </div>
      )}

      {/* Existing schedule info */}
      {schedule && (
        <div className="space-y-2 py-2 border-t border-white/10">
          <div className="flex justify-between text-[10px]">
            <span className="text-white/40">TYPE</span>
            <span className="text-white/70 uppercase">{schedule.type}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-white/40">STATUS</span>
            <span className={cn(
              "uppercase",
              schedule.status === "active" ? "text-emerald-400/70" : "text-amber-400/70"
            )}>
              {schedule.status}
            </span>
          </div>
          {schedule.cron && (
            <div className="flex justify-between text-[10px]">
              <span className="text-white/40">CRON</span>
              <span className="text-white/70 font-mono">{schedule.cron}</span>
            </div>
          )}
          {schedule.intervalMs && (
            <div className="flex justify-between text-[10px]">
              <span className="text-white/40">INTERVAL</span>
              <span className="text-white/70 font-mono">{schedule.intervalMs}ms</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t border-white/10">
        {!schedule && (
          <button
            onClick={handleSave}
            disabled={!agentType || !scheduleName.trim()}
            className="px-4 py-2 text-[11px] uppercase tracking-wider bg-white text-black hover:bg-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            CREATE
          </button>
        )}
        {schedule && (
          <>
            <button
              onClick={handleTogglePause}
              className="px-4 py-2 text-[11px] uppercase tracking-wider border border-white/30 text-white/70 hover:border-white hover:text-white transition-colors"
            >
              {schedule.status === "paused" ? "RESUME" : "PAUSE"}
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 text-[11px] uppercase tracking-wider border border-red-500/50 text-red-400/70 hover:border-red-500 hover:text-red-400 transition-colors"
            >
              DELETE
            </button>
          </>
        )}
        <button
          onClick={onClose}
          className="px-4 py-2 text-[11px] uppercase tracking-wider text-white/50 hover:text-white transition-colors ml-auto"
        >
          {schedule ? "CLOSE" : "CANCEL"}
        </button>
      </div>
    </div>
  );
}

// Settings Panel - Vars and danger zone
function SettingsPanel({
  agencyId,
  onClose,
}: {
  agencyId: string;
  onClose: () => void;
}) {
  const { vars, setVar, deleteVar, deleteAgency } = useAgency(agencyId);
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarValue, setNewVarValue] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleAddVar = async () => {
    if (newVarKey.trim()) {
      await setVar(newVarKey.trim(), newVarValue);
      setNewVarKey("");
      setNewVarValue("");
    }
  };

  const handleDeleteAgency = async () => {
    await deleteAgency();
    onClose();
  };

  return (
    <div className="p-4 space-y-6 overflow-y-auto">
      {/* Variables */}
      <div>
        <h3 className="text-[10px] uppercase tracking-widest text-white/50 mb-3 border-b border-white/10 pb-2">
          VARIABLES
        </h3>
        
        <div className="space-y-2">
          {Object.entries(vars).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[11px] text-white/70 font-mono flex-1 truncate">
                {key}
              </span>
              <span className="text-[10px] text-white/40 truncate max-w-[200px]">
                {typeof value === "string" && value.length > 20
                  ? value.slice(0, 20) + "..."
                  : String(value)}
              </span>
              <button
                onClick={() => deleteVar(key)}
                className="text-[10px] text-red-400/50 hover:text-red-400 transition-colors"
              >
                [X]
              </button>
            </div>
          ))}
          {Object.keys(vars).length === 0 && (
            <p className="text-[10px] text-white/30">No variables set</p>
          )}
        </div>

        {/* Add new var */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={newVarKey}
            onChange={(e) => setNewVarKey(e.target.value)}
            placeholder="KEY"
            className="flex-1 px-2 py-1.5 bg-black border border-white/30 text-white text-[10px] uppercase font-mono focus:outline-none focus:border-white"
          />
          <input
            type="text"
            value={newVarValue}
            onChange={(e) => setNewVarValue(e.target.value)}
            placeholder="value"
            className="flex-1 px-2 py-1.5 bg-black border border-white/30 text-white text-[10px] font-mono focus:outline-none focus:border-white"
          />
          <button
            onClick={handleAddVar}
            disabled={!newVarKey.trim()}
            className="px-3 py-1.5 text-[10px] uppercase tracking-wider border border-white/30 text-white/60 hover:border-white hover:text-white disabled:opacity-30 transition-colors"
          >
            ADD
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="pt-4 border-t border-red-500/20">
        <h3 className="text-[10px] uppercase tracking-widest text-red-400/50 mb-3">
          DANGER ZONE
        </h3>
        
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2 text-[11px] uppercase tracking-wider border border-red-500/30 text-red-400/60 hover:border-red-500 hover:text-red-400 transition-colors"
          >
            DELETE AGENCY
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-red-400/70">
              This will permanently delete this agency and all its agents, files, and configuration.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDeleteAgency}
                className="px-4 py-2 text-[11px] uppercase tracking-wider bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                CONFIRM DELETE
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-[11px] uppercase tracking-wider text-white/50 hover:text-white transition-colors"
              >
                CANCEL
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DetailOverlay;
