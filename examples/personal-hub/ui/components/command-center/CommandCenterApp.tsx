/**
 * CommandCenterApp - Wires hooks to CommandCenter component
 */
import { useState, useCallback, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { CommandCenter, type DashboardMetrics } from "./CommandCenter";
import { MindPanel } from "../MindPanel";
import {
  useAgencies,
  useAgency,
  useAgent,
  useActivityFeed,
  useAgencyMetrics,
  usePlugins,
  getClient,
} from "../../hooks";
import type { AgentEvent } from "agent-hub/client";

// Special agent types
const AGENCY_MIND_TYPE = "_agency-mind";

interface CommandCenterAppProps {
  onToggleLayout?: () => void;
}

export function CommandCenterApp({ onToggleLayout }: CommandCenterAppProps) {
  const [location, navigate] = useLocation();

  // Agency creation modal
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [newAgencyName, setNewAgencyName] = useState("");

  // Agency Mind panel state
  const [isMindOpen, setIsMindOpen] = useState(false);
  const [mindAgentId, setMindAgentId] = useState<string | null>(null);
  const [isMindLoading, setIsMindLoading] = useState(false);

  // Parse agency from URL
  const pathParts = location.split("/").filter(Boolean);
  const agencyId = pathParts[0] || null;

  // Data hooks
  const { agencies, create: createAgency } = useAgencies();
  const {
    agents,
    blueprints,
    schedules,
    vars,
    memoryDisks,
    spawnAgent,
    getOrCreateMind,
    loading: agencyLoading,
    // Settings actions
    createSchedule,
    deleteSchedule,
    pauseSchedule,
    resumeSchedule,
    triggerSchedule,
    getScheduleRuns,
    refreshSchedules,
    setVar,
    deleteVar,
    createMemoryDisk,
    importMemoryDisk,
    deleteMemoryDisk,
    refreshMemoryDisks,
    createBlueprint,
    updateBlueprint,
    deleteBlueprint,
    listDirectory,
    readFile,
    writeFile,
    deleteFile,
    deleteAgency,
  } = useAgency(agencyId);

  const { plugins, tools } = usePlugins();

  // Activity feed
  const { items: activityItems, addUserMessage, refresh: refreshActivity } = useActivityFeed(agencyId);

  // Agency metrics (initial fetch + WebSocket updates, no polling)
  const { metrics: aggregatedMetrics, subscribeToNewAgents } = useAgencyMetrics(agencyId);

  // Agency Mind state
  const {
    state: mindState,
    run: mindRunState,
    connected: mindConnected,
    loading: mindAgentLoading,
    sendMessage: sendMindMessage,
    cancel: cancelMind,
  } = useAgent(agencyId, mindAgentId);

  // Derive agent status
  const agentStatus = useMemo(() => {
    const status: Record<string, "running" | "paused" | "done" | "error" | "idle"> = {};
    agents.forEach((a) => {
      status[a.id] = "idle";
    });
    return status;
  }, [agents]);

  // Subscribe to new agents when the agent list changes
  useEffect(() => {
    subscribeToNewAgents();
  }, [agents.length, subscribeToNewAgents]);

  // Calculate dashboard metrics
  const metrics: DashboardMetrics = useMemo(() => {
    const visibleAgents = agents.filter((a) => !a.agentType.startsWith("_"));
    const activeCount = Object.values(agentStatus).filter((s) => s === "running").length;
    const errorCount = Object.values(agentStatus).filter((s) => s === "error").length;
    const idleCount = visibleAgents.length - activeCount - errorCount;

    const activeSchedules = schedules.filter((s) => s.status !== "paused").length;
    const pausedSchedules = schedules.filter((s) => s.status === "paused").length;

    // Calculate token usage from aggregated metrics
    const today = new Date().toISOString().split("T")[0];
    const todayTokens = aggregatedMetrics.tokensByDay.get(today) || 0;

    // Get last 7 days of token data
    const tokenDailyData: number[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      tokenDailyData.push(aggregatedMetrics.tokensByDay.get(dateStr) || 0);
    }
    const weekTokens = tokenDailyData.reduce((a, b) => a + b, 0);

    // Calculate response time stats
    const responseTimes = aggregatedMetrics.responseTimes;
    const avgResponse = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;
    const sortedTimes = [...responseTimes].sort((a, b) => a - b);
    const p95Response = sortedTimes.length > 0
      ? sortedTimes[Math.floor(sortedTimes.length * 0.95)] || sortedTimes[sortedTimes.length - 1]
      : 0;
    // Get last 12 response times for sparkline
    const recentResponseData = responseTimes.slice(-12);

    // Calculate success rate from real data
    const totalRuns = aggregatedMetrics.runsCompleted + aggregatedMetrics.runsErrored;
    const successRate = totalRuns > 0
      ? Math.round((aggregatedMetrics.runsCompleted / totalRuns) * 100)
      : 100; // Default to 100% if no runs yet

    // Generate hourly run data (simplified: just use total runs distributed)
    // In a real implementation, you'd track timestamps per run
    const hourlyData = Array.from({ length: 24 }, () => 0);
    // Put all runs in current hour for simplicity
    const currentHour = new Date().getHours();
    hourlyData[currentHour] = totalRuns;

    // Memory disks count
    const totalMemoryEntries = memoryDisks.reduce((acc, d) => acc + (d.size || 0), 0);

    return {
      agents: {
        total: visibleAgents.length,
        active: activeCount,
        idle: idleCount,
        error: errorCount,
      },
      runs: {
        today: aggregatedMetrics.runsCompleted + aggregatedMetrics.runsErrored,
        week: aggregatedMetrics.runsCompleted + aggregatedMetrics.runsErrored,
        successRate,
        hourlyData,
      },
      schedules: {
        total: schedules.length,
        active: activeSchedules,
        paused: pausedSchedules,
      },
      tokens: weekTokens > 0 ? {
        today: todayTokens,
        week: weekTokens,
        dailyData: tokenDailyData,
      } : undefined,
      responseTime: avgResponse > 0 ? {
        avg: avgResponse,
        p95: p95Response,
        recentData: recentResponseData,
      } : undefined,
      memory: memoryDisks.length > 0 ? {
        disks: memoryDisks.length,
        totalEntries: totalMemoryEntries,
      } : undefined,
    };
  }, [agents, agentStatus, schedules, memoryDisks, aggregatedMetrics]);

  // Reset mind state when agency changes
  useEffect(() => {
    setMindAgentId(null);
    setIsMindOpen(false);
  }, [agencyId]);

  // Get agent events for trace modal
  const getAgentEvents = useCallback(async (agentId: string): Promise<AgentEvent[]> => {
    if (!agencyId) return [];
    
    try {
      const client = getClient().agency(agencyId).agent(agentId);
      const { events } = await client.getEvents();
      return events;
    } catch (err) {
      console.error("Failed to get agent events:", err);
      return [];
    }
  }, [agencyId]);

  // Handle agency selection
  const handleSelectAgency = useCallback((id: string) => {
    navigate(`/${id}`);
  }, [navigate]);

  // Handle agency creation
  const handleCreateAgency = useCallback(async (name?: string) => {
    if (name) {
      const agency = await createAgency(name);
      navigate(`/${agency.id}`);
      setShowAgencyModal(false);
      setNewAgencyName("");
    } else {
      setShowAgencyModal(true);
    }
  }, [createAgency, navigate]);

  // Handle sending message to a target
  const handleSendMessage = useCallback(async (target: string, message: string) => {
    if (!agencyId) return;

    const client = getClient().agency(agencyId);

    // Handle Agency Mind
    if (target === "_agency-mind") {
      if (!mindAgentId) {
        setIsMindLoading(true);
        try {
          const id = await getOrCreateMind();
          setMindAgentId(id);
          setIsMindOpen(true);
          setTimeout(async () => {
            const agentClient = client.agent(id);
            await agentClient.invoke({ messages: [{ role: "user", content: message }] });
            refreshActivity();
          }, 100);
        } finally {
          setIsMindLoading(false);
        }
      } else {
        setIsMindOpen(true);
        await sendMindMessage(message);
        refreshActivity();
      }
      return;
    }

    // Handle regular agent by ID
    const agent = agents.find((a) => a.id === target);
    if (agent) {
      addUserMessage(agent.agentType, message, agent.id);
      const agentClient = client.agent(agent.id);
      await agentClient.invoke({ messages: [{ role: "user", content: message }] });
      refreshActivity();
      return;
    }

    console.warn("Unknown target:", target);
  }, [agencyId, agents, mindAgentId, getOrCreateMind, sendMindMessage, addUserMessage, refreshActivity]);

  // Handle creating a new agent
  const handleCreateAgent = useCallback(async (blueprintName: string) => {
    if (!agencyId) return;
    await spawnAgent(blueprintName);
    refreshActivity();
  }, [agencyId, spawnAgent, refreshActivity]);

  // Handle test blueprint - spawn and navigate
  const handleTestBlueprint = useCallback(async (name: string) => {
    if (!agencyId) return;
    const agent = await spawnAgent(name);
    // Could open trace modal here
  }, [agencyId, spawnAgent]);

  // Handle delete agency
  const handleDeleteAgency = useCallback(async () => {
    await deleteAgency();
    navigate("/");
  }, [deleteAgency, navigate]);

  return (
    <>
      <CommandCenter
        agencies={agencies}
        selectedAgencyId={agencyId}
        agents={agents}
        blueprints={blueprints}
        schedules={schedules}
        agentStatus={agentStatus}
        activityItems={activityItems}
        metrics={metrics}
        vars={vars}
        memoryDisks={memoryDisks}
        plugins={plugins}
        tools={tools}
        getAgentEvents={getAgentEvents}
        onSelectAgency={handleSelectAgency}
        onCreateAgency={handleCreateAgency}
        onSendMessage={handleSendMessage}
        onCreateAgent={handleCreateAgent}
        onCreateSchedule={createSchedule}
        onDeleteSchedule={deleteSchedule}
        onPauseSchedule={pauseSchedule}
        onResumeSchedule={resumeSchedule}
        onTriggerSchedule={triggerSchedule}
        onGetScheduleRuns={getScheduleRuns}
        onRefreshSchedules={refreshSchedules}
        onSetVar={setVar}
        onDeleteVar={deleteVar}
        onCreateMemoryDisk={createMemoryDisk}
        onImportMemoryDisk={importMemoryDisk}
        onDeleteMemoryDisk={deleteMemoryDisk}
        onRefreshMemoryDisks={refreshMemoryDisks}
        onCreateBlueprint={createBlueprint}
        onUpdateBlueprint={updateBlueprint}
        onDeleteBlueprint={deleteBlueprint}
        onTestBlueprint={handleTestBlueprint}
        listDirectory={listDirectory}
        readFile={readFile}
        writeFile={writeFile}
        deleteFile={deleteFile}
        onDeleteAgency={handleDeleteAgency}
        isLoading={agencyLoading}
        onToggleLayout={onToggleLayout}
      />

      {/* Agency Modal */}
      {showAgencyModal && (
        <AgencyCreateModal
          value={newAgencyName}
          onChange={setNewAgencyName}
          onSubmit={() => handleCreateAgency(newAgencyName)}
          onClose={() => {
            setShowAgencyModal(false);
            setNewAgencyName("");
          }}
        />
      )}

      {/* Agency Mind Panel */}
      {agencyId && (
        <MindPanel
          isOpen={isMindOpen}
          onClose={() => setIsMindOpen(false)}
          agencyId={agencyId}
          agencyName={agencies.find((a) => a.id === agencyId)?.name}
          mindState={mindState}
          runState={mindRunState}
          connected={mindConnected}
          loading={isMindLoading || mindAgentLoading}
          onSendMessage={sendMindMessage}
          onStop={cancelMind}
        />
      )}
    </>
  );
}

// Agency create modal
function AgencyCreateModal({
  value,
  onChange,
  onSubmit,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-white max-w-md w-full overflow-hidden">
        <div className="px-3 py-2 border-b border-white flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-white">
            NEW_AGENCY
          </h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-xs"
          >
            [X]
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSubmit();
          }}
          className="p-3"
        >
          <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-2">
            AGENCY_NAME:
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="ENTER IDENTIFIER..."
            autoFocus
            className="w-full px-3 py-2 border border-white/50 bg-black text-white text-xs uppercase tracking-wider placeholder:text-white/30 focus:outline-none focus:border-white"
          />
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-white/50 border border-white/30 hover:border-white hover:text-white transition-colors"
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-3 py-1.5 text-[11px] uppercase tracking-wider bg-white text-black border border-white hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              CREATE
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CommandCenterApp;
