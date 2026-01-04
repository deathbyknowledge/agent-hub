import { useState, useMemo, useEffect, useCallback, StrictMode } from "react";
import { useLocation, useRoute } from "wouter";
import {
  Sidebar,
  ContentHeader,
  ChatView,
  TraceView,
  FilesView,
  TodosView,
  SettingsView,
  ConfirmModal,
  MindPanel,
  HomeView,
  type TabId,
  type Message,
  type Todo,
} from "./components";
import {
  useAgencies,
  useAgency,
  useAgent,
  usePlugins,
  useActivityFeed,
  useAgencyMetrics,
  setStoredSecret,
  QueryClient,
  QueryClientProvider,
} from "./hooks";
import type { AgentBlueprint, ChatMessage, ToolCall as APIToolCall } from "agent-hub/client";
import { createRoot } from "react-dom/client";
import {
  type ScheduleSummary,
  type DashboardMetrics,
  convertChatMessages,
  isSystemBlueprint,
} from "./components/shared";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

// System blueprints start with _ and are hidden from the picker
function isSystemBlueprintLocal(bp: AgentBlueprint): boolean {
  return bp.name.startsWith("_");
}

// Blueprint picker component
function BlueprintPicker({
  blueprints,
  onSelect,
  onClose,
}: {
  blueprints: AgentBlueprint[];
  onSelect: (bp: AgentBlueprint) => void;
  onClose: () => void;
}) {
  // Filter out system blueprints
  const visibleBlueprints = blueprints.filter((bp) => !isSystemBlueprintLocal(bp));

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
      <div className="bg-black border border-white max-w-md w-full mx-4 overflow-hidden">
        <div className="px-3 py-2 border-b border-white flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-white">
            SELECT_BLUEPRINT
          </h2>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-xs"
          >
            [X]
          </button>
        </div>
        <div className="p-3 max-h-80 overflow-y-auto">
          {visibleBlueprints.length === 0 ? (
            <p className="text-white/30 text-[10px] uppercase tracking-wider text-center py-4">
              // NO BLUEPRINTS AVAILABLE
            </p>
          ) : (
            <div className="space-y-1">
              {visibleBlueprints.map((bp) => (
                <button
                  key={bp.name}
                  onClick={() => onSelect(bp)}
                  className="w-full text-left p-2 border border-white/30 hover:border-white hover:bg-white/5 transition-colors"
                >
                  <div className="text-[11px] uppercase tracking-wider text-white">
                    {bp.name}
                  </div>
                  {bp.description && (
                    <div className="text-[10px] text-white/50 mt-1">
                      {bp.description}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Agency create modal component
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

// Auth unlock form component
function AuthUnlockForm({
  onUnlock,
  error,
}: {
  onUnlock: (secret: string) => void;
  error?: string;
}) {
  const [secret, setSecret] = useState("");

  return (
    <div className="h-screen flex items-center justify-center bg-black p-4">
      <div className="max-w-md w-full border border-white p-6">
        <div className="text-center mb-6">
          <div className="text-[#00ff00] text-4xl mb-4 font-mono">█</div>
          <h1 className="text-xs uppercase tracking-widest text-white mb-2">
            AGENT_HUB // SECURE ACCESS
          </h1>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            AUTHENTICATION REQUIRED
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (secret.trim()) {
              onUnlock(secret.trim());
            }
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-2">
              ACCESS_KEY:
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••"
              autoFocus
              className="w-full px-3 py-2 border border-white/50 bg-black text-white text-xs tracking-wider placeholder:text-white/20 focus:outline-none focus:border-white"
            />
          </div>
          {error && (
            <p className="text-[#ff0000] text-[10px] uppercase tracking-wider text-center border border-[#ff0000] p-2">
              ERROR: {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!secret.trim()}
            className="w-full px-4 py-2 text-[11px] uppercase tracking-widest bg-white text-black border border-white hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            AUTHENTICATE
          </button>
        </form>
        <div className="mt-6 text-[10px] text-white/20 text-center font-mono">
          SYS.BUILD: v0.1 | SEC.LEVEL: HIGH
        </div>
      </div>
    </div>
  );
}

function AuthLoadingScreen() {
  return (
    <div className="h-screen flex items-center justify-center bg-black p-4">
      <div className="max-w-md w-full border border-white p-6">
        <div className="text-center mb-6">
          <div className="text-[#00ff00] text-4xl mb-4 font-mono animate-pulse">
            █
          </div>
          <h1 className="text-xs uppercase tracking-widest text-white mb-2">
            AGENT_HUB // SECURE ACCESS
          </h1>
          <p className="text-[10px] uppercase tracking-wider text-white/40">
            CHECKING CREDENTIALS
          </p>
        </div>
        <div className="space-y-3">
          <div className="h-2 border border-white/30">
            <div className="h-full w-2/3 bg-white/70 animate-pulse" />
          </div>
          <p className="text-[10px] uppercase tracking-wider text-white/30 text-center">
            WAITING_FOR_RESPONSE
          </p>
        </div>
        <div className="mt-6 text-[10px] text-white/20 text-center font-mono">
          SYS.BUILD: v0.1 | SEC.LEVEL: HIGH
        </div>
      </div>
    </div>
  );
}

// Event detail modal component
function EventDetailModal({
  event,
  label,
  type,
  onClose,
}: {
  event: unknown;
  label: string;
  type: string;
  onClose: () => void;
}) {
  const eventData = event as { ts?: string; data?: Record<string, unknown> };

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
      <div className="bg-black border border-white max-w-2xl w-full mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        <div className="px-3 py-2 border-b border-white flex items-center justify-between shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-[11px] uppercase tracking-wider text-white truncate">
              {label}
            </h2>
            <p className="text-[10px] text-white/40 font-mono truncate">{type}</p>
          </div>
          <button
            onClick={onClose}
            className="text-white/50 hover:text-white text-xs shrink-0"
          >
            [X]
          </button>
        </div>
        <div className="p-3 overflow-auto flex-1">
          {eventData.ts && (
            <div className="mb-4">
              <label className="text-[10px] uppercase tracking-wider text-white/40 block mb-1">
                TIMESTAMP:
              </label>
              <p className="text-xs text-[#00ff00] font-mono">
                {new Date(eventData.ts).toLocaleString()}
              </p>
            </div>
          )}
          {eventData.data && Object.keys(eventData.data).length > 0 && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-white/40 block mb-1">
                DATA:
              </label>
              <pre className="text-[11px] bg-white/5 border border-white/20 p-3 overflow-auto text-[#ffaa00]">
                {JSON.stringify(eventData.data, null, 2)}
              </pre>
            </div>
          )}
          {(!eventData.data || Object.keys(eventData.data).length === 0) && (
            <p className="text-[10px] uppercase tracking-wider text-white/30">
              // NO DATA PAYLOAD
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Agent View Component (handles /:agencyId/agent/:agentId/:tab?)
// ============================================================================

function AgentView({
  agencyId,
  agentId,
  tab = "chat",
  onMenuClick,
}: {
  agencyId: string;
  agentId: string;
  tab?: string;
  onMenuClick?: () => void;
}) {
  const {
    agents,
    listDirectory,
    readFile,
    refreshAgents,
    deleteAgent,
    loading: agencyLoading,
  } = useAgency(agencyId);
  const {
    state: agentState,
    run: runState,
    events,
    sendMessage,
    cancel,
    loading: agentLoading,
  } = useAgent(agencyId, agentId);
  const [, navigate] = useLocation();

  // Event detail modal state
  const [selectedEvent, setSelectedEvent] = useState<{
    event: unknown;
    label: string;
    type: string;
  } | null>(null);
  const [showDeleteAgent, setShowDeleteAgent] = useState(false);

  const activeTab = (
    ["chat", "trace", "files", "todos"].includes(tab) ? tab : "chat"
  ) as TabId;
  const selectedAgent = agents.find((a) => a.id === agentId);

  // Get messages from agent state
  const messages = useMemo(() => {
    return convertChatMessages(agentState?.messages || []);
  }, [agentState?.messages]);

  // Derive status from run state
  const status = useMemo(() => {
    if (!runState) return "idle" as const;
    if (runState.status === "running") return "running" as const;
    if (runState.status === "completed") return "done" as const;
    if (runState.status === "error") return "error" as const;
    return "idle" as const;
  }, [runState]);

  // Derive todos from agent state
  const todos = useMemo((): Todo[] => {
    const stateTodos = (
      agentState as {
        todos?: Array<{ content: string; status: string }>;
      } | null
    )?.todos;
    if (!stateTodos) return [];
    return stateTodos.map((t, i) => ({
      id: `todo-${i}`,
      title: t.content,
      status:
        t.status === "completed"
          ? "done"
          : t.status === "in_progress"
            ? "in_progress"
            : "pending",
      priority: "medium" as const,
      createdAt: new Date().toISOString(),
    }));
  }, [agentState]);

  const handleSendMessage = async (content: string) => {
    await sendMessage(content);
  };

  const handleConfirmDeleteAgent = async () => {
    if (!selectedAgent) return;
    await deleteAgent(selectedAgent.id);
    await refreshAgents();
    navigate(`/${agencyId}`);
  };

  // Render content based on active tab
  const renderContent = () => {
    switch (activeTab) {
      case "chat":
        return (
          <ChatView
            messages={messages}
            onSendMessage={handleSendMessage}
            onStop={cancel}
            isLoading={agentLoading}
          />
        );
      case "trace":
        return (
          <TraceView
            events={events}
            threads={agents}
            onEventClick={(event, label, type) =>
              setSelectedEvent({ event, label, type })
            }
          />
        );
      case "files":
        return (
          <FilesView
            listDirectory={listDirectory}
            readFile={readFile}
            allowUpload={false}
            headerLabel="Files"
          />
        );
      case "todos":
        return <TodosView todos={todos} />;
      default:
        return null;
    }
  };

  if (!selectedAgent) {
    if (agencyLoading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-pulse text-neutral-500">Loading agent...</div>
        </div>
      );
    }
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400">
        <p className="text-lg">Agent not found</p>
      </div>
    );
  }

  return (
    <>
      <ContentHeader
        threadName={selectedAgent.agentType}
        threadId={selectedAgent.id}
        agencyId={agencyId}
        activeTab={activeTab}
        status={status}
        onStop={cancel}
        onDelete={() => setShowDeleteAgent(true)}
        onMenuClick={onMenuClick}
      />
      <div className="flex-1 flex flex-col overflow-hidden">{renderContent()}</div>

      {/* Event detail modal */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent.event}
          label={selectedEvent.label}
          type={selectedEvent.type}
          onClose={() => setSelectedEvent(null)}
        />
      )}
      {showDeleteAgent && (
        <ConfirmModal
          title="Delete Agent"
          message="Are you sure you want to delete this agent? This removes all schedules and storage."
          confirmLabel="Delete"
          variant="danger"
          onConfirm={async () => {
            await handleConfirmDeleteAgent();
            setShowDeleteAgent(false);
          }}
          onCancel={() => setShowDeleteAgent(false)}
        />
      )}
    </>
  );
}

// ============================================================================
// Settings View Wrapper (handles /:agencyId/settings)
// ============================================================================

function SettingsRoute({
  agencyId,
  onMenuClick,
}: {
  agencyId: string;
  onMenuClick?: () => void;
}) {
  const {
    blueprints,
    schedules,
    vars,
    memoryDisks,
    refreshSchedules,
    createSchedule,
    deleteSchedule,
    pauseSchedule,
    resumeSchedule,
    triggerSchedule,
    getScheduleRuns,
    setVar,
    deleteVar,
    refreshMemoryDisks,
    createMemoryDisk,
    importMemoryDisk,
    deleteMemoryDisk,
    createBlueprint,
    updateBlueprint,
    deleteBlueprint,
    spawnAgent,
    listDirectory,
    readFile,
    writeFile,
    deleteFile,
    deleteAgency,
  } = useAgency(agencyId);
  const { agencies } = useAgencies();
  const { plugins, tools } = usePlugins();
  const agency = agencies.find((a) => a.id === agencyId);
  const [, navigate] = useLocation();
  const [showDeleteAgency, setShowDeleteAgency] = useState(false);

  return (
    <>
      <div className="px-3 py-2 border-b border-white bg-black relative shrink-0">
        {/* Mobile menu button */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="md:hidden absolute top-2 left-2 p-2 text-white/50 hover:text-white transition-colors z-10"
            aria-label="Open menu"
          >
            <span className="text-xs">[=]</span>
          </button>
        )}
        <h1 className="text-xs uppercase tracking-widest text-white md:ml-0 ml-8">
          AGENCY_CONFIG
        </h1>
        <p className="text-[10px] text-white/40 font-mono md:ml-0 ml-8">
          ID: {agency?.name || "UNKNOWN"}
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <SettingsView
          agencyId={agencyId}
          agencyName={agency?.name}
          onMenuClick={onMenuClick}
          blueprints={blueprints}
          schedules={schedules}
          vars={vars}
          memoryDisks={memoryDisks}
          onCreateSchedule={createSchedule}
          onDeleteSchedule={deleteSchedule}
          onPauseSchedule={pauseSchedule}
          onResumeSchedule={resumeSchedule}
          onTriggerSchedule={triggerSchedule}
          onGetScheduleRuns={getScheduleRuns}
          onRefreshSchedules={refreshSchedules}
          onSetVar={setVar}
          onDeleteVar={deleteVar}
          onCreateMemoryDisk={async (name, desc, entries) => {
            await createMemoryDisk(name, desc, entries);
          }}
          onImportMemoryDisk={importMemoryDisk}
          onDeleteMemoryDisk={deleteMemoryDisk}
          onRefreshMemoryDisks={refreshMemoryDisks}
          onCreateBlueprint={createBlueprint}
          onUpdateBlueprint={updateBlueprint}
          onDeleteBlueprint={deleteBlueprint}
          onTestBlueprint={async (name) => {
            const agent = await spawnAgent(name);
            navigate(`/${agencyId}/agent/${agent.id}`);
          }}
          plugins={plugins}
          tools={tools}
          listDirectory={listDirectory}
          readFile={readFile}
          writeFile={writeFile}
          deleteFile={deleteFile}
          onDeleteAgency={() => setShowDeleteAgency(true)}
        />
      </div>

      {showDeleteAgency && (
        <ConfirmModal
          title="Delete Agency"
          message="This will delete all agents, files, and configuration for this agency. This cannot be undone."
          confirmLabel="Delete Agency"
          variant="danger"
          onConfirm={async () => {
            await deleteAgency();
            setShowDeleteAgency(false);
            navigate("/");
          }}
          onCancel={() => setShowDeleteAgency(false)}
        />
      )}
    </>
  );
}

// ============================================================================
// Home View Route (handles /:agencyId - dashboard)
// ============================================================================

function HomeRoute({
  agencyId,
  onMenuClick,
  onCreateAgent,
}: {
  agencyId: string;
  onMenuClick?: () => void;
  onCreateAgent: (blueprintName: string) => Promise<void>;
}) {
  const { agencies } = useAgencies();
  const { agents, blueprints, spawnAgent, getOrCreateMind, sendMessageToAgent } = useAgency(agencyId);
  const { items: activityItems, addUserMessage, refresh: refreshActivity } = useActivityFeed(agencyId);
  const { metrics, subscribeToNewAgents } = useAgencyMetrics(agencyId);
  const [, navigate] = useLocation();

  const agency = agencies.find((a) => a.id === agencyId);

  // Build dashboard metrics
  const dashboardMetrics: DashboardMetrics = useMemo(() => {
    const activeAgents = agents.filter((a) => !a.agentType.startsWith("_")).length;
    return {
      agents: {
        total: activeAgents,
        active: metrics.runsCompleted > 0 ? Math.min(activeAgents, metrics.runsCompleted) : 0,
        idle: activeAgents,
        error: metrics.runsErrored,
      },
      runs: {
        today: metrics.runsCompleted + metrics.runsErrored,
        week: metrics.runsCompleted + metrics.runsErrored,
        successRate:
          metrics.runsCompleted + metrics.runsErrored > 0
            ? Math.round((metrics.runsCompleted / (metrics.runsCompleted + metrics.runsErrored)) * 100)
            : 100,
        hourlyData: Array.from(metrics.tokensByDay.values()).slice(-12),
      },
      schedules: {
        total: 0, // Will be populated from useAgency
        active: 0,
        paused: 0,
      },
      tokens: metrics.totalTokens > 0 ? {
        today: metrics.totalTokens,
        week: metrics.totalTokens,
        dailyData: Array.from(metrics.tokensByDay.values()),
      } : undefined,
      responseTime: metrics.responseTimes.length > 0 ? {
        avg: Math.round(metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length),
        p95: Math.round(metrics.responseTimes.sort((a, b) => a - b)[Math.floor(metrics.responseTimes.length * 0.95)] || 0),
        recentData: metrics.responseTimes.slice(-12),
      } : undefined,
    };
  }, [agents, metrics]);

  // Handle sending message to agent - stays in command center view
  const handleSendMessage = useCallback(
    async (target: string, message: string) => {
      // Find or create the target agent
      let targetAgentId: string;
      let isNewAgent = false;

      if (target === "_agency-mind") {
        // Get or create the agency mind
        targetAgentId = await getOrCreateMind();
        // Check if this is a newly created mind
        isNewAgent = !agents.find((a) => a.id === targetAgentId);
      } else {
        // Find existing agent
        const agent = agents.find((a) => a.id === target);
        if (!agent) {
          console.error("Agent not found:", target);
          return;
        }
        targetAgentId = agent.id;
      }

      // Add optimistic update to activity feed
      addUserMessage(target, message, targetAgentId);

      // Actually send the message to the agent
      await sendMessageToAgent(targetAgentId, message);

      // If we created a new agent, subscribe to it for metrics/activity updates
      if (isNewAgent) {
        subscribeToNewAgents();
      }

      // Refresh activity feed to pick up any immediate responses
      // (WebSocket will handle real-time updates after this)
      setTimeout(() => refreshActivity(), 1000);
    },
    [agents, getOrCreateMind, addUserMessage, sendMessageToAgent, subscribeToNewAgents, refreshActivity]
  );

  // Handle creating new agent from blueprint
  const handleCreateAgent = useCallback(
    async (blueprintName: string) => {
      const agent = await spawnAgent(blueprintName);
      navigate(`/${agencyId}/agent/${agent.id}`);
    },
    [agencyId, spawnAgent, navigate]
  );

  return (
    <HomeView
      agencyId={agencyId}
      agencyName={agency?.name}
      agents={agents}
      blueprints={blueprints}
      metrics={dashboardMetrics}
      activityItems={activityItems}
      onSendMessage={handleSendMessage}
      onCreateAgent={handleCreateAgent}
      onMenuClick={onMenuClick}
    />
  );
}

// ============================================================================
// Empty State (no agency selected)
// ============================================================================

function EmptyState({
  onMenuClick,
}: {
  onMenuClick?: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center relative bg-black">
      {/* Mobile menu button */}
      {onMenuClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMenuClick();
          }}
          className="md:hidden fixed top-4 left-4 p-2 text-white/50 hover:text-white transition-colors z-10"
          aria-label="Open menu"
        >
          <span className="text-xs">[=]</span>
        </button>
      )}
      <div className="text-center max-w-md px-4 border border-white/20 p-8">
        <div className="text-[#00ff00] text-3xl mb-4 font-mono">▓</div>
        <h2 className="text-xs uppercase tracking-widest text-white mb-3">
          SYSTEM INITIALIZED
        </h2>
        <p className="text-[10px] uppercase tracking-wider text-white/40 mb-4">
          SELECT AGENCY FROM CONTROL PANEL OR INITIALIZE NEW INSTANCE
        </p>
        <div className="text-[10px] text-white/20 font-mono">
          STATUS: AWAITING_SELECTION
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Content Router
// ============================================================================

function MainContent({
  agencyId,
  onMenuClick,
  onCreateAgent,
}: {
  agencyId: string | null;
  onMenuClick: () => void;
  onCreateAgent: (blueprintName: string) => Promise<void>;
}) {
  // Match routes
  const [matchAgent, paramsAgent] = useRoute("/:agencyId/agent/:agentId");
  const [matchAgentTab, paramsAgentTab] = useRoute("/:agencyId/agent/:agentId/:tab");
  const [matchSettings] = useRoute("/:agencyId/settings");
  const [matchHome] = useRoute("/:agencyId");

  if (!agencyId) {
    return <EmptyState onMenuClick={onMenuClick} />;
  }

  if (matchSettings) {
    return <SettingsRoute agencyId={agencyId} onMenuClick={onMenuClick} />;
  }

  if (matchAgentTab && paramsAgentTab) {
    return (
      <AgentView
        agencyId={agencyId}
        agentId={paramsAgentTab.agentId}
        tab={paramsAgentTab.tab}
        onMenuClick={onMenuClick}
      />
    );
  }

  if (matchAgent && paramsAgent) {
    return (
      <AgentView
        agencyId={agencyId}
        agentId={paramsAgent.agentId}
        onMenuClick={onMenuClick}
      />
    );
  }

  // Default to home/dashboard view
  if (matchHome) {
    return (
      <HomeRoute
        agencyId={agencyId}
        onMenuClick={onMenuClick}
        onCreateAgent={onCreateAgent}
      />
    );
  }

  return <EmptyState onMenuClick={onMenuClick} />;
}

// ============================================================================
// App Component
// ============================================================================

export default function App() {
  const [location, navigate] = useLocation();

  // Auth state
  const [isLocked, setIsLocked] = useState(false);
  const [authError, setAuthError] = useState<string | undefined>();

  // Mobile menu state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768;
    }
    return true;
  });

  // Modal state
  const [showBlueprintPicker, setShowBlueprintPicker] = useState(false);
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [newAgencyName, setNewAgencyName] = useState("");

  // Agency Mind panel state
  const [isMindOpen, setIsMindOpen] = useState(false);
  const [mindAgentId, setMindAgentId] = useState<string | null>(null);
  const [isMindLoading, setIsMindLoading] = useState(false);

  // Parse agencyId from URL
  const pathParts = location.split("/").filter(Boolean);
  const agencyId = pathParts[0] || null;
  const agentId = pathParts[1] === "agent" ? pathParts[2] || null : null;

  // Data hooks
  const {
    agencies,
    create: createAgency,
    error: agenciesError,
    hasFetched: agenciesFetched,
  } = useAgencies();
  const { agents, blueprints, schedules, spawnAgent, getOrCreateMind } = useAgency(agencyId);
  const { run: runState } = useAgent(agencyId, agentId);

  // Agency Mind agent state
  const {
    state: mindState,
    run: mindRunState,
    connected: mindConnected,
    loading: mindAgentLoading,
    sendMessage: sendMindMessage,
    cancel: cancelMind,
  } = useAgent(agencyId, mindAgentId);

  const isUnauthorized = agenciesError?.message.includes("401") ?? false;

  // Check if we got a 401 error
  useEffect(() => {
    if (agenciesError && agenciesError.message.includes("401")) {
      setIsLocked(true);
    }
  }, [agenciesError]);

  // Handle unlock attempt
  const handleUnlock = useCallback((secret: string) => {
    setStoredSecret(secret);
    setAuthError(undefined);
    window.location.reload();
  }, []);

  // Reset mind agent when agency changes
  useEffect(() => {
    setMindAgentId(null);
    setIsMindOpen(false);
  }, [agencyId]);

  // Handle opening the Agency Mind panel
  const handleOpenMind = useCallback(async () => {
    if (!agencyId) return;

    if (mindAgentId) {
      setIsMindOpen(true);
      return;
    }

    setIsMindLoading(true);
    try {
      const id = await getOrCreateMind();
      setMindAgentId(id);
      setIsMindOpen(true);
    } catch (err) {
      console.error("Failed to get or create mind:", err);
    } finally {
      setIsMindLoading(false);
    }
  }, [agencyId, mindAgentId, getOrCreateMind]);

  // Derive agent status
  const agentStatus = useMemo(() => {
    const status: Record<string, "running" | "paused" | "done" | "error" | "idle"> = {};
    agents.forEach((a) => {
      if (a.id === agentId && runState) {
        status[a.id] =
          runState.status === "running"
            ? "running"
            : runState.status === "completed"
              ? "done"
              : runState.status === "error"
                ? "error"
                : "idle";
      } else {
        status[a.id] = "idle";
      }
    });
    return status;
  }, [agents, agentId, runState]);

  // Convert schedules to summary format
  const scheduleSummaries: ScheduleSummary[] = useMemo(() => {
    return schedules.map((s) => ({
      id: s.id,
      name: s.name,
      agentType: s.agentType,
      status: (s.status === "paused" ? "paused" : "active") as "active" | "paused",
      type: s.type as "once" | "cron" | "interval",
    }));
  }, [schedules]);

  // Handlers
  const handleCreateAgency = async (name?: string) => {
    if (name) {
      const agency = await createAgency(name);
      navigate(`/${agency.id}`);
      setShowAgencyModal(false);
      setNewAgencyName("");
    } else {
      setShowAgencyModal(true);
    }
  };

  const handleCreateAgent = async (agentType?: string) => {
    if (agentType && agencyId) {
      const agent = await spawnAgent(agentType);
      navigate(`/${agencyId}/agent/${agent.id}`);
      setShowBlueprintPicker(false);
    } else {
      setShowBlueprintPicker(true);
    }
  };

  if (!agenciesFetched) {
    return <AuthLoadingScreen />;
  }

  if (isLocked || isUnauthorized) {
    return <AuthUnlockForm onUnlock={handleUnlock} error={authError} />;
  }

  return (
    <div className="h-screen flex bg-black">
      {/* Sidebar */}
      <Sidebar
        agencies={agencies}
        selectedAgencyId={agencyId}
        onCreateAgency={handleCreateAgency}
        agents={agents}
        selectedAgentId={agentId}
        onCreateAgent={() => handleCreateAgent()}
        schedules={scheduleSummaries}
        agentStatus={agentStatus}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onOpenMind={handleOpenMind}
        isMindActive={isMindOpen}
      />

      {/* Blueprint picker modal */}
      {showBlueprintPicker && (
        <BlueprintPicker
          blueprints={blueprints}
          onSelect={(bp) => handleCreateAgent(bp.name)}
          onClose={() => setShowBlueprintPicker(false)}
        />
      )}

      {/* Agency creation modal */}
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

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <MainContent
          agencyId={agencyId}
          onMenuClick={() => setIsMobileMenuOpen(true)}
          onCreateAgent={handleCreateAgent}
        />
      </div>

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
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
