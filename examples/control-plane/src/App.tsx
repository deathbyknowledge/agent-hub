import { useState, useMemo, useEffect, useCallback, StrictMode } from "react";
import { useLocation } from "wouter";
import {
  ContentHeader,
  ChatView,
  TraceView,
  FilesView,
  SettingsView,
  ConfirmModal,
  ErrorBoundary,
  ToastProvider,
  useToast,
  TopHeader,
  TabBar,
  CommandPalette,
  AgentPanel,
  BottomPanel,
  type Message,
  type OpenTab,
} from "./components";
import {
  useAgencies,
  useAgency,
  useAgent,
  usePlugins,
  setStoredSecret,
  getStoredHubUrl,
  setStoredHubUrl,
  clearStoredHubUrl,
  isHubConfigured,
  QueryClient,
  QueryClientProvider,
} from "./hooks";
import type { AgentBlueprint, ChatMessage, AgentSummary, AgencyMeta } from "agents-hub/client";
import { createRoot } from "react-dom/client";
import { convertChatMessages } from "./components/shared";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

// ============================================================================
// Hub Connection Screen - Connect to any Agent Hub deployment
// ============================================================================

function HubConnectScreen({
  onConnect,
  error,
}: {
  onConnect: (url: string, secret?: string) => void;
  error?: string;
}) {
  const [hubUrl, setHubUrl] = useState(getStoredHubUrl() || "");
  const [secret, setSecret] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  // Detect mixed content issue (HTTPS page trying to connect to HTTP hub)
  const isHttpsPage = window.location.protocol === "https:";
  const isHttpHub = hubUrl.trim().toLowerCase().startsWith("http://");
  const hasMixedContentIssue = isHttpsPage && isHttpHub;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hubUrl.trim()) return;
    
    setIsConnecting(true);
    onConnect(hubUrl.trim(), secret.trim() || undefined);
  };

  return (
    <div className="h-screen flex items-center justify-center bg-black p-4">
      <div className="max-w-md w-full border border-white overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white">
          <div className="text-center">
            <div className="text-[#00ff00] text-4xl mb-3 font-mono">█</div>
            <h1 className="text-xs uppercase tracking-widest text-white mb-1">
              AGENT_HUB // CONTROL_PLANE
            </h1>
            <p className="text-[10px] uppercase tracking-wider text-white/40">
              CONNECT TO ANY DEPLOYED HUB
            </p>
          </div>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-2">
              HUB_URL:
            </label>
            <input
              type="url"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              placeholder="https://your-hub.workers.dev"
              autoFocus
              className="w-full px-3 py-2 border border-white/50 bg-black text-white text-xs tracking-wider placeholder:text-white/30 focus:outline-none focus:border-white font-mono"
            />
            <p className="mt-1 text-[9px] text-white/30">
              Enter the URL of your deployed Agent Hub
            </p>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-2">
              SECRET (OPTIONAL):
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-white/50 bg-black text-white text-xs tracking-wider placeholder:text-white/20 focus:outline-none focus:border-white"
            />
            <p className="mt-1 text-[9px] text-white/30">
              Required if the hub has authentication enabled
            </p>
          </div>

          {hasMixedContentIssue && (
            <div className="p-2 border border-[#ffaa00] text-[#ffaa00] text-[10px] uppercase tracking-wider">
              WARNING: HTTPS page cannot connect to HTTP hub (mixed content).
              Use a tunnel (cloudflared/ngrok) or run control-plane locally.
            </div>
          )}

          {error && (
            <div className="p-2 border border-[#ff0000] text-[#ff0000] text-[10px] uppercase tracking-wider">
              ERROR: {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!hubUrl.trim() || isConnecting || hasMixedContentIssue}
            className="w-full px-4 py-2 text-[11px] uppercase tracking-widest bg-white text-black border border-white hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {isConnecting ? "CONNECTING..." : "CONNECT TO HUB"}
          </button>
        </form>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-white/20 text-center">
          <span className="text-[10px] text-white/20 font-mono">
            UNIVERSAL CONTROL PLANE | v0.1
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

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
          {blueprints.length === 0 ? (
            <p className="text-white/30 text-[10px] uppercase tracking-wider text-center py-4">
              // NO BLUEPRINTS AVAILABLE
            </p>
          ) : (
            <div className="space-y-1">
              {blueprints.map((bp) => (
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

// Agency select/create modal - shown when no agency is selected
function AgencySelectModal({
  agencies,
  onSelect,
  onCreate,
  hubUrl,
  onDisconnect,
}: {
  agencies: { id: string; name?: string }[];
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  hubUrl: string;
  onDisconnect: () => void;
}) {
  const [mode, setMode] = useState<"select" | "create">(agencies.length > 0 ? "select" : "create");
  const [newName, setNewName] = useState("");

  const handleCreate = () => {
    if (newName.trim()) {
      onCreate(newName.trim());
    }
  };

  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Hub connection bar - always visible */}
      <div className="px-3 py-1.5 border-b border-white/20 bg-black flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-white/40">
            CONNECTED:
          </span>
          <span className="text-[9px] font-mono text-[#00ff00] truncate max-w-[300px]">
            {hubUrl}
          </span>
        </div>
        <button
          onClick={onDisconnect}
          className="text-[9px] uppercase tracking-wider text-white/40 hover:text-[#ff0000] transition-colors"
        >
          [DISCONNECT]
        </button>
      </div>

      {/* Centered content */}
      <div className="flex-1 flex items-center justify-center p-4">
      <div className="max-w-md w-full border border-white overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white">
          <div className="text-center">
            <div className="text-[#00ff00] text-4xl mb-3 font-mono">█</div>
            <h1 className="text-xs uppercase tracking-widest text-white mb-1">
              AGENT_HUB
            </h1>
            <p className="text-[10px] uppercase tracking-wider text-white/40">
              {agencies.length === 0
                ? "INITIALIZE YOUR FIRST AGENCY"
                : "SELECT OR CREATE AGENCY"}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {agencies.length === 0 ? (
            // No agencies - show create form with explanation
            <div>
              <div className="mb-4 p-3 border border-white/20">
                <p className="text-[10px] uppercase tracking-wider text-white/60 leading-relaxed">
                  AN AGENCY IS YOUR WORKSPACE FOR AI AGENTS. CREATE ONE TO GET STARTED WITH SPAWNING AND MANAGING AGENTS.
                </p>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreate();
                }}
              >
                <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-2">
                  AGENCY_NAME:
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="MY_AGENCY"
                  autoFocus
                  className="w-full px-3 py-2 border border-white/50 bg-black text-white text-xs uppercase tracking-wider placeholder:text-white/30 focus:outline-none focus:border-white"
                />
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="w-full mt-4 px-4 py-2 text-[11px] uppercase tracking-widest bg-white text-black border border-white hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  INITIALIZE AGENCY
                </button>
              </form>
            </div>
          ) : mode === "select" ? (
            // Has agencies - show selection list
            <div>
              <div className="mb-3 text-[10px] uppercase tracking-wider text-white/40">
                AVAILABLE AGENCIES ({agencies.length})
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto mb-4">
                {agencies.map((agency) => (
                  <button
                    key={agency.id}
                    onClick={() => onSelect(agency.id)}
                    className="w-full px-3 py-2 text-left border border-white/30 hover:border-white hover:bg-white/5 transition-colors group"
                  >
                    <span className="text-[11px] uppercase tracking-wider text-white group-hover:text-white">
                      {agency.name || agency.id}
                    </span>
                    <span className="text-[9px] text-white/30 font-mono ml-2">
                      {agency.id.slice(0, 8)}
                    </span>
                  </button>
                ))}
              </div>
              <div className="border-t border-white/20 pt-3">
                <button
                  onClick={() => setMode("create")}
                  className="w-full px-3 py-2 text-[11px] uppercase tracking-wider text-white/50 border border-white/30 hover:border-white hover:text-white transition-colors"
                >
                  + CREATE NEW AGENCY
                </button>
              </div>
            </div>
          ) : (
            // Create new agency form
            <div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCreate();
                }}
              >
                <label className="block text-[10px] uppercase tracking-wider text-white/50 mb-2">
                  AGENCY_NAME:
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="ENTER IDENTIFIER..."
                  autoFocus
                  className="w-full px-3 py-2 border border-white/50 bg-black text-white text-xs uppercase tracking-wider placeholder:text-white/30 focus:outline-none focus:border-white"
                />
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setMode("select")}
                    className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider text-white/50 border border-white/30 hover:border-white hover:text-white transition-colors"
                  >
                    BACK
                  </button>
                  <button
                    type="submit"
                    disabled={!newName.trim()}
                    className="flex-1 px-3 py-2 text-[11px] uppercase tracking-wider bg-white text-black border border-white hover:bg-black hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    CREATE
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-white/20 text-center">
          <span className="text-[10px] text-white/20 font-mono">
            SYS.BUILD: v0.1 | STATUS: READY
          </span>
        </div>
      </div>
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
// Agent View Component - Chat-first layout with collapsible bottom panel
// ============================================================================

function AgentView({
  agencyId,
  agentId,
}: {
  agencyId: string;
  agentId: string;
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
  } = useAgent(agencyId, agentId);
  const [, navigate] = useLocation();
  const { showError } = useToast();

  // Event detail modal state
  const [selectedEvent, setSelectedEvent] = useState<{
    event: unknown;
    label: string;
    type: string;
  } | null>(null);
  const [showDeleteAgent, setShowDeleteAgent] = useState(false);

  const selectedAgent = agents.find((a: AgentSummary) => a.id === agentId);

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

  const handleSendMessage = async (content: string) => {
    try {
      await sendMessage(content);
    } catch (err) {
      console.error("[AgentView] Failed to send message:", err);
      showError("Failed to send message. Please try again.");
    }
  };

  const handleConfirmDeleteAgent = async () => {
    if (!selectedAgent) return;
    try {
      await deleteAgent(selectedAgent.id);
      await refreshAgents();
      navigate(`/${agencyId}`);
    } catch (err) {
      console.error("[AgentView] Failed to delete agent:", err);
      showError("Failed to delete agent. Please try again.");
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

  // Trace view content for bottom panel
  const traceContent = (
    <TraceView
      events={events}
      threads={agents}
      onEventClick={(event, label, type) =>
        setSelectedEvent({ event, label, type })
      }
    />
  );

  // Files view content for bottom panel
  const filesContent = (
    <FilesView
      listDirectory={listDirectory}
      readFile={readFile}
      allowUpload={false}
      headerLabel="Files"
    />
  );

  return (
    <>
      {/* Header */}
      <ContentHeader
        threadName={selectedAgent.agentType}
        threadId={selectedAgent.id}
        status={status}
        onStop={cancel}
        onDelete={() => setShowDeleteAgent(true)}
      />

      {/* Main content area - chat takes priority */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Chat view - always visible, takes remaining space */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatView
            messages={messages}
            onSendMessage={handleSendMessage}
            onStop={cancel}
            isLoading={status === "running"}
            scrollKey={agentId}
          />
        </div>

        {/* Bottom panel - collapsible trace/files */}
        <BottomPanel
          traceContent={traceContent}
          filesContent={filesContent}
          defaultExpanded={false}
          defaultTab="trace"
        />
      </div>

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
}: {
  agencyId: string;
}) {
  const {
    blueprints,
    schedules,
    vars,
    memoryDisks,
    mcpServers,
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
    addMcpServer,
    removeMcpServer,
    retryMcpServer,
  } = useAgency(agencyId);
  const { agencies } = useAgencies();
  const { plugins, tools } = usePlugins();
  const agency = agencies.find((a: { id: string }) => a.id === agencyId);
  const [, navigate] = useLocation();
  const [showDeleteAgency, setShowDeleteAgency] = useState(false);

  return (
    <>
      <div className="px-3 py-2 border-b border-white bg-black shrink-0">
        <h1 className="text-xs uppercase tracking-widest text-white">
          AGENCY_CONFIG
        </h1>
        <p className="text-[10px] text-white/40 font-mono">
          ID: {agency?.name || "UNKNOWN"}
        </p>
      </div>
      <div className="flex-1 overflow-hidden">
        <SettingsView
          agencyId={agencyId}
          agencyName={agency?.name}
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
          mcpServers={mcpServers}
          onAddMcpServer={addMcpServer}
          onRemoveMcpServer={removeMcpServer}
          onRetryMcpServer={retryMcpServer}
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
// Connected Header - shows hub URL and disconnect option
// ============================================================================

function ConnectedTopHeader({
  hubUrl,
  onDisconnect,
  ...props
}: {
  hubUrl: string;
  onDisconnect: () => void;
  agencies: AgencyMeta[];
  selectedAgencyId: string | null;
  selectedAgencyName?: string;
  onSelectAgency: (id: string) => void;
  onCreateAgency: () => void;
  onOpenSettings: () => void;
  onOpenCommandPalette: () => void;
  onTogglePanel: () => void;
  isPanelOpen: boolean;
}) {
  return (
    <div className="flex flex-col">
      {/* Hub connection bar */}
      <div className="px-3 py-1 border-b border-white/20 bg-black flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-wider text-white/40">
            CONNECTED:
          </span>
          <span className="text-[9px] font-mono text-[#00ff00]">
            {hubUrl}
          </span>
        </div>
        <button
          onClick={onDisconnect}
          className="text-[9px] uppercase tracking-wider text-white/40 hover:text-[#ff0000] transition-colors"
        >
          [DISCONNECT]
        </button>
      </div>
      <TopHeader {...props} />
    </div>
  );
}

// ============================================================================
// App Component - IDE-style layout with tabs
// ============================================================================

function MainApp() {
  const [location, navigate] = useLocation();
  const { showError } = useToast();

  // Hub connection state
  const [hubConfigured, setHubConfigured] = useState(isHubConfigured());
  const [connectionError, setConnectionError] = useState<string | undefined>();

  // Auth state
  const [isLocked, setIsLocked] = useState(false);
  const [authError, setAuthError] = useState<string | undefined>();

  // UI state
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [newAgencyName, setNewAgencyName] = useState("");

  // Tab state - tracks open agents
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);

  // Parse agencyId and agentId from URL
  const pathParts = location.split("/").filter(Boolean);
  const agencyId = pathParts[0] || null;
  const agentId = pathParts[1] === "agent" ? pathParts[2] || null : null;
  const isOnSettings = location.endsWith("/settings");

  // Data hooks
  const {
    agencies,
    create: createAgency,
    error: agenciesError,
    hasFetched: agenciesFetched,
  } = useAgencies();
  const { agents, blueprints, spawnAgent } = useAgency(agencyId);
  const { run: runState } = useAgent(agencyId, agentId);

  const isUnauthorized = agenciesError?.message.includes("401") ?? false;

  // Current agency
  const currentAgency = agencies.find((a: { id: string }) => a.id === agencyId);

  // Track running agents
  const runningAgentIds = useMemo(() => {
    const ids = new Set<string>();
    if (agentId && runState?.status === "running") {
      ids.add(agentId);
    }
    return ids;
  }, [agentId, runState]);

  // Sync tabs with agents - add tab when navigating to agent
  useEffect(() => {
    if (!agentId || !agencyId) return;
    
    const agent = agents.find((a: AgentSummary) => a.id === agentId);
    if (!agent) return;

    // Check if tab already exists
    const existingTab = openTabs.find((t) => t.agentId === agentId);
    if (!existingTab) {
      // Add new tab
      setOpenTabs((prev) => [
        ...prev,
        {
          id: `tab-${agentId}`,
          agentId: agent.id,
          agentType: agent.agentType,
          isRunning: runState?.status === "running",
        },
      ]);
    }
  }, [agentId, agencyId, agents, runState?.status]);

  // Update tab running state
  useEffect(() => {
    if (!agentId) return;
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.agentId === agentId
          ? { ...tab, isRunning: runState?.status === "running" }
          : tab
      )
    );
  }, [agentId, runState?.status]);

  // Clear tabs when agency changes
  useEffect(() => {
    setOpenTabs([]);
  }, [agencyId]);

  // Check if we got a 401 error
  useEffect(() => {
    if (agenciesError && agenciesError.message.includes("401")) {
      setIsLocked(true);
    }
  }, [agenciesError]);

  // Handle hub connection
  const handleConnect = useCallback((url: string, secret?: string) => {
    setStoredHubUrl(url);
    if (secret) {
      setStoredSecret(secret);
    }
    setConnectionError(undefined);
    setHubConfigured(true);
    // Force re-render with new client
    window.location.reload();
  }, []);

  // Handle hub disconnection
  const handleDisconnect = useCallback(() => {
    clearStoredHubUrl();
    setHubConfigured(false);
    navigate("/");
    window.location.reload();
  }, [navigate]);

  // Handle unlock attempt
  const handleUnlock = useCallback((secret: string) => {
    setStoredSecret(secret);
    setAuthError(undefined);
    window.location.reload();
  }, []);

  // Auto-select agency if only one exists
  useEffect(() => {
    if (!agenciesFetched || isLocked || isUnauthorized) return;
    if (!agencyId && agencies.length === 1) {
      navigate(`/${agencies[0].id}`);
    }
  }, [agenciesFetched, isLocked, isUnauthorized, agencyId, agencies, navigate]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K or Cmd+K - Open command palette
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // Ctrl+B - Toggle panel
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setIsPanelOpen((prev) => !prev);
        return;
      }

      // Ctrl+W - Close current tab
      if ((e.ctrlKey || e.metaKey) && e.key === "w" && agentId) {
        e.preventDefault();
        handleCloseTab(`tab-${agentId}`);
        return;
      }

      // Ctrl+1-9 - Switch to tab by index
      if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (openTabs[index]) {
          navigate(`/${agencyId}/agent/${openTabs[index].agentId}`);
        }
        return;
      }

      // Ctrl+Tab - Next tab
      if (e.ctrlKey && e.key === "Tab" && !e.shiftKey) {
        e.preventDefault();
        const currentIndex = openTabs.findIndex((t) => t.agentId === agentId);
        const nextIndex = (currentIndex + 1) % openTabs.length;
        if (openTabs[nextIndex]) {
          navigate(`/${agencyId}/agent/${openTabs[nextIndex].agentId}`);
        }
        return;
      }

      // Ctrl+Shift+Tab - Previous tab
      if (e.ctrlKey && e.key === "Tab" && e.shiftKey) {
        e.preventDefault();
        const currentIndex = openTabs.findIndex((t) => t.agentId === agentId);
        const prevIndex = currentIndex <= 0 ? openTabs.length - 1 : currentIndex - 1;
        if (openTabs[prevIndex]) {
          navigate(`/${agencyId}/agent/${openTabs[prevIndex].agentId}`);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [agencyId, agentId, openTabs, navigate]);

  // Handlers
  const handleSelectAgency = (id: string) => {
    navigate(`/${id}`);
  };

  const handleCreateAgency = async (name?: string) => {
    if (name) {
      try {
        const agency = await createAgency(name);
        navigate(`/${agency.id}`);
        setShowAgencyModal(false);
        setNewAgencyName("");
      } catch (err) {
        console.error("[App] Failed to create agency:", err);
        showError("Failed to create agency. Please try again.");
      }
    } else {
      setShowAgencyModal(true);
    }
  };

  const handleSelectAgent = (agent: { id: string; agentType: string }) => {
    if (agencyId) {
      navigate(`/${agencyId}/agent/${agent.id}`);
    }
  };

  const handleCreateFromBlueprint = async (blueprint: AgentBlueprint) => {
    if (!agencyId) return;
    try {
      const agent = await spawnAgent(blueprint.name);
      navigate(`/${agencyId}/agent/${agent.id}`);
    } catch (err) {
      console.error("[App] Failed to create agent:", err);
      showError("Failed to create agent. Please try again.");
    }
  };

  const handleSelectTab = (tabId: string) => {
    const tab = openTabs.find((t) => t.id === tabId);
    if (tab && agencyId) {
      navigate(`/${agencyId}/agent/${tab.agentId}`);
    }
  };

  const handleCloseTab = (tabId: string) => {
    const tabIndex = openTabs.findIndex((t) => t.id === tabId);
    const tab = openTabs[tabIndex];
    
    setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));

    // Navigate to adjacent tab or home
    if (tab && tab.agentId === agentId) {
      const remainingTabs = openTabs.filter((t) => t.id !== tabId);
      if (remainingTabs.length > 0) {
        const nextTab = remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)];
        navigate(`/${agencyId}/agent/${nextTab.agentId}`);
      } else {
        navigate(`/${agencyId}`);
      }
    }
  };

  const handleOpenSettings = () => {
    if (agencyId) {
      navigate(`/${agencyId}/settings`);
    }
  };

  // Show hub connection screen if not configured
  if (!hubConfigured) {
    return (
      <HubConnectScreen
        onConnect={handleConnect}
        error={connectionError}
      />
    );
  }

  // Loading state
  if (!agenciesFetched) {
    return <AuthLoadingScreen />;
  }

  // Auth required
  if (isLocked || isUnauthorized) {
    return <AuthUnlockForm onUnlock={handleUnlock} error={authError} />;
  }

  // No agency selected
  if (!agencyId && agencies.length !== 1) {
    return (
      <AgencySelectModal
        agencies={agencies}
        onSelect={(id) => navigate(`/${id}`)}
        onCreate={async (name) => {
          const agency = await createAgency(name);
          navigate(`/${agency.id}`);
        }}
        hubUrl={getStoredHubUrl() || ""}
        onDisconnect={handleDisconnect}
      />
    );
  }

  // Active tab ID
  const activeTabId = agentId ? `tab-${agentId}` : null;
  const hubUrl = getStoredHubUrl() || "";

  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Top Header with hub connection info */}
      <ConnectedTopHeader
        hubUrl={hubUrl}
        onDisconnect={handleDisconnect}
        agencies={agencies}
        selectedAgencyId={agencyId}
        selectedAgencyName={currentAgency?.name}
        onSelectAgency={handleSelectAgency}
        onCreateAgency={() => handleCreateAgency()}
        onOpenSettings={handleOpenSettings}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onTogglePanel={() => setIsPanelOpen((prev) => !prev)}
        isPanelOpen={isPanelOpen}
      />

      {/* Tab Bar */}
      {agencyId && !isOnSettings && (
        <TabBar
          tabs={openTabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={() => setIsCommandPaletteOpen(true)}
        />
      )}

      {/* Main content area */}
      <div className="flex-1 flex min-h-0">
        {/* Agent Panel (sidebar) */}
        {agencyId && (
          <AgentPanel
            isOpen={isPanelOpen}
            agents={agents}
            blueprints={blueprints}
            runningAgentIds={runningAgentIds}
            onSelectAgent={handleSelectAgent}
            onCreateFromBlueprint={handleCreateFromBlueprint}
          />
        )}

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {isOnSettings && agencyId ? (
            <SettingsRoute agencyId={agencyId} />
          ) : agentId && agencyId ? (
            <AgentView agencyId={agencyId} agentId={agentId} />
          ) : agencyId ? (
            <EmptyState onOpenCommandPalette={() => setIsCommandPaletteOpen(true)} />
          ) : null}
        </div>
      </div>

      {/* Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        agents={agents}
        blueprints={blueprints}
        onSelectAgent={handleSelectAgent}
        onCreateFromBlueprint={handleCreateFromBlueprint}
      />

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
    </div>
  );
}

// Empty state when no agent is selected
function EmptyState({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center px-4">
        <div className="text-6xl text-white/10 font-mono mb-4">_</div>
        <h2 className="text-[11px] uppercase tracking-widest text-white/40 mb-2">
          NO AGENT SELECTED
        </h2>
        <p className="text-[10px] text-white/30 mb-4">
          Open an agent or create a new one to get started.
        </p>
        <button
          onClick={onOpenCommandPalette}
          className="px-4 py-2 text-[10px] uppercase tracking-wider border border-white/30 text-white/50 hover:border-white hover:text-white transition-colors"
        >
          [Ctrl+K] Open Command Palette
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <MainApp />
          </ToastProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
