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
  type TabId,
  type Message,
  type Todo,
} from "./components";
import {
  useAgencies,
  useAgency,
  useAgent,
  usePlugins,
  setStoredSecret,
  QueryClient,
  QueryClientProvider,
} from "./hooks";
import type {
  AgentBlueprint,
  ChatMessage,
  ToolCall as APIToolCall,
} from "agent-hub/client";
import { createRoot } from "react-dom/client";

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

// Convert ChatMessage[] from API to Message[] for ChatView
// API ChatMessage types:
// - { role: "system" | "user" | "assistant"; content: string; ts?: string }
// - { role: "assistant"; toolCalls?: ToolCall[]; ts?: string }
// - { role: "tool"; content: string; toolCallId: string; ts?: string }
function convertChatMessages(apiMessages: ChatMessage[]): Message[] {
  const messages: Message[] = [];
  const toolResults = new Map<
    string,
    { content: string; status: "done" | "error" }
  >();

  // First pass: collect tool results
  for (const msg of apiMessages) {
    if (msg.role === "tool") {
      const toolMsg = msg as {
        role: "tool";
        content: string;
        toolCallId: string;
      };
      toolResults.set(toolMsg.toolCallId, {
        content: toolMsg.content,
        status: "done",
      });
    }
  }

  // Second pass: build messages with tool calls
  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i];
    // Use timestamp from message if available (populated by store)
    const timestamp = msg.ts || "";

    if (msg.role === "tool") {
      // Skip tool messages - they're attached to assistant messages
      continue;
    }

    if (msg.role === "assistant") {
      const assistantMsg = msg as
        | { role: "assistant"; content: string; ts?: string }
        | { role: "assistant"; toolCalls?: APIToolCall[]; ts?: string };

      // Check if this is a tool call message
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

        // Get content if it exists (some messages have both content and tool calls)
        const content =
          "content" in assistantMsg
            ? (assistantMsg as { content?: string }).content || ""
            : "";

        messages.push({
          id: `msg-${i}`,
          role: "assistant",
          content,
          timestamp,
          toolCalls,
        });
      } else if ("content" in assistantMsg && assistantMsg.content) {
        // Regular assistant message with content
        messages.push({
          id: `msg-${i}`,
          role: "assistant",
          content: assistantMsg.content,
          timestamp,
        });
      }
    } else {
      // User or system message
      const contentMsg = msg as { role: "user" | "system"; content: string };
      messages.push({
        id: `msg-${i}`,
        role: contentMsg.role,
        content: contentMsg.content || "",
        timestamp,
      });
    }
  }

  return messages;
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
            <p className="text-[10px] text-white/40 font-mono truncate">
              {type}
            </p>
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
      <div className="flex-1 flex flex-col overflow-hidden">
        {renderContent()}
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
      <div className="px-3 py-2 border-b border-white bg-black relative">
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
// Empty State (no agent selected)
// ============================================================================

function EmptyState({
  hasAgency,
  hasAgents,
  onMenuClick,
}: {
  hasAgency: boolean;
  hasAgents?: boolean;
  onMenuClick?: () => void;
}) {
  if (!hasAgency) {
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

  if (!hasAgents) {
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
        <div className="text-center max-w-md px-4 border border-dashed border-white/30 p-8">
          <div className="text-white/30 text-2xl mb-4 font-mono">+</div>
          <h2 className="text-xs uppercase tracking-widest text-white mb-3">
            NO AGENTS DEPLOYED
          </h2>
          <p className="text-[10px] uppercase tracking-wider text-white/40 mb-4">
            SPAWN NEW AGENT VIA CONTROL PANEL. SELECT BLUEPRINT TO INITIALIZE.
          </p>
          <div className="text-[10px] text-white/20 font-mono">
            AGENTS: 0 | READY: TRUE
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center relative bg-black">
      {/* Mobile menu button */}
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="md:hidden fixed top-4 left-4 p-2 text-white/50 hover:text-white transition-colors z-10"
          aria-label="Open menu"
        >
          <span className="text-xs">[=]</span>
        </button>
      )}
      <div className="text-center max-w-md px-4 border border-white/20 p-8">
        <div className="text-white/40 text-2xl mb-4 font-mono">◈</div>
        <h2 className="text-xs uppercase tracking-widest text-white mb-3">
          SELECT AGENT
        </h2>
        <p className="text-[10px] uppercase tracking-wider text-white/40">
          CHOOSE ACTIVE AGENT FROM CONTROL PANEL TO ACCESS TERMINAL
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Content Router
// ============================================================================

function MainContent({
  agencyId,
  hasAgents,
  onMenuClick,
}: {
  agencyId: string | null;
  hasAgents: boolean;
  onMenuClick: () => void;
}) {
  // Match agent routes
  const [matchAgent, paramsAgent] = useRoute("/:agencyId/agent/:agentId");
  const [matchAgentTab, paramsAgentTab] = useRoute(
    "/:agencyId/agent/:agentId/:tab"
  );
  const [matchSettings] = useRoute("/:agencyId/settings");

  if (!agencyId) {
    return <EmptyState hasAgency={false} onMenuClick={onMenuClick} />;
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

  return (
    <EmptyState
      hasAgency={true}
      hasAgents={hasAgents}
      onMenuClick={onMenuClick}
    />
  );
}

// ============================================================================
// App Component
// ============================================================================

export default function App() {
  const [location, navigate] = useLocation();

  // Auth state - check if we need to show unlock form
  const [isLocked, setIsLocked] = useState(false);
  const [authError, setAuthError] = useState<string | undefined>();

  // Mobile menu state - default to true for desktop, false for mobile
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768;
    }
    return true;
  });

  // Parse agencyId and agentId from URL
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
  const { agents, blueprints, spawnAgent } = useAgency(agencyId);
  const { run: runState } = useAgent(agencyId, agentId);
  const isUnauthorized = agenciesError?.message.includes("401") ?? false;

  // Check if we got a 401 error (need auth)
  useEffect(() => {
    if (agenciesError && agenciesError.message.includes("401")) {
      setIsLocked(true);
    }
  }, [agenciesError]);

  // Handle unlock attempt
  const handleUnlock = useCallback((secret: string) => {
    setStoredSecret(secret);
    setAuthError(undefined);
    // Reload the page to re-init all hooks with the new secret
    window.location.reload();
  }, []);

  // Modal state
  const [showBlueprintPicker, setShowBlueprintPicker] = useState(false);
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [newAgencyName, setNewAgencyName] = useState("");

  // Derive agent status
  const agentStatus = useMemo(() => {
    const status: Record<
      string,
      "running" | "paused" | "done" | "error" | "idle"
    > = {};
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

  // Show auth unlock form if locked
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
        agentStatus={agentStatus}
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
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
          hasAgents={agents.length > 0}
          onMenuClick={() => setIsMobileMenuOpen(true)}
        />
      </div>
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
