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
  Robot,
  Plus,
  ChatCircle,
  type TabId,
  type Message,
  type FileNode,
  type Todo,
} from "./components";
import { useAgencies, useAgency, useAgent, usePlugins, getStoredSecret, setStoredSecret } from "./hooks";
import type {
  AgentBlueprint,
  ChatMessage,
  ToolCall as APIToolCall,
} from "@client";
import { createRoot } from "react-dom/client";

// ============================================================================
// Helper Functions
// ============================================================================

// Convert ChatMessage[] from API to Message[] for ChatView
// API ChatMessage types:
// - { role: "system" | "user" | "assistant"; content: string }
// - { role: "assistant"; toolCalls?: ToolCall[] }
// - { role: "tool"; content: string; toolCallId: string }
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
    const timestamp = new Date().toISOString();

    if (msg.role === "tool") {
      // Skip tool messages - they're attached to assistant messages
      continue;
    }

    if (msg.role === "assistant") {
      const assistantMsg = msg as
        | { role: "assistant"; content: string }
        | { role: "assistant"; toolCalls?: APIToolCall[] };

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

// Build file tree from API response
// Note: entry.path from API is already the full path (e.g., "agents/abc123/file.txt")
async function buildFileTree(
  entries: {
    type: "file" | "dir";
    path: string;
    size?: number;
    modified?: string;
  }[],
  _basePath: string, // kept for interface consistency but not used
  listDirectory: (path: string) => Promise<{ entries: typeof entries }>,
  readFile: (path: string) => Promise<{ content: string }>
): Promise<FileNode[]> {
  const nodes: FileNode[] = [];

  for (const entry of entries) {
    // Remove trailing slash and extract last path segment
    const cleanPath = entry.path.replace(/\/+$/, "");
    const name = cleanPath.split("/").pop() || cleanPath;
    // entry.path is already the full path from API
    const fullPath = cleanPath;

    if (entry.type === "dir") {
      // Recursively load directory contents
      let children: FileNode[] = [];
      try {
        const { entries: subEntries } = await listDirectory(fullPath);
        children = await buildFileTree(
          subEntries,
          fullPath,
          listDirectory,
          readFile
        );
      } catch {
        // Directory might be empty or inaccessible
      }
      nodes.push({
        id: `dir-${fullPath}`,
        name,
        type: "directory",
        children,
      });
    } else {
      nodes.push({
        id: `file-${fullPath}`,
        name,
        type: "file",
        size: entry.size,
        modifiedAt: entry.modified,
      });
    }
  }

  return nodes;
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
            Select Agent Type
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            ✕
          </button>
        </div>
        <div className="p-4 max-h-80 overflow-y-auto">
          {blueprints.length === 0 ? (
            <p className="text-neutral-500 text-sm text-center py-4">
              No blueprints available
            </p>
          ) : (
            <div className="space-y-2">
              {blueprints.map((bp) => (
                <button
                  key={bp.name}
                  onClick={() => onSelect(bp)}
                  className="w-full text-left p-3 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
                >
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">
                    {bp.name}
                  </div>
                  {bp.description && (
                    <div className="text-sm text-neutral-500 mt-1">
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-md w-full mx-4 overflow-hidden">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
            Create Agency
          </h2>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            ✕
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onSubmit();
          }}
          className="p-4"
        >
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
            Agency Name
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter agency name..."
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Create
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
    <div className="h-screen flex items-center justify-center bg-neutral-950">
      <div className="max-w-md w-full mx-4">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <Robot size={32} className="text-orange-500" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-100 mb-2">Agent Hub</h1>
          <p className="text-neutral-400 text-sm">
            Enter your secret key to continue
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
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Enter hub secret..."
            autoFocus
            className="w-full px-4 py-3 rounded-lg border border-neutral-700 bg-neutral-800 text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
          />
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
          <button
            type="submit"
            disabled={!secret.trim()}
            className="w-full px-4 py-3 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Unlock
          </button>
        </form>
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-2xl w-full mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">
              {label}
            </h2>
            <p className="text-xs text-neutral-500 font-mono">{type}</p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            ✕
          </button>
        </div>
        <div className="p-4 overflow-auto flex-1">
          {eventData.ts && (
            <div className="mb-4">
              <label className="text-xs font-medium text-neutral-500 uppercase">
                Timestamp
              </label>
              <p className="text-sm text-neutral-900 dark:text-neutral-100 font-mono">
                {new Date(eventData.ts).toLocaleString()}
              </p>
            </div>
          )}
          {eventData.data && Object.keys(eventData.data).length > 0 && (
            <div>
              <label className="text-xs font-medium text-neutral-500 uppercase mb-2 block">
                Data
              </label>
              <pre className="text-xs bg-neutral-100 dark:bg-neutral-800 p-3 rounded-lg overflow-auto text-neutral-800 dark:text-neutral-200">
                {JSON.stringify(eventData.data, null, 2)}
              </pre>
            </div>
          )}
          {(!eventData.data || Object.keys(eventData.data).length === 0) && (
            <p className="text-sm text-neutral-500 italic">
              No additional data
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
}: {
  agencyId: string;
  agentId: string;
  tab?: string;
}) {
  const {
    agents,
    blueprints,
    spawnAgent,
    listDirectory,
    readFile,
  } = useAgency(agencyId);
  const {
    state: agentState,
    run: runState,
    events,
    sendMessage,
    cancel,
    loading: agentLoading,
  } = useAgent(agencyId, agentId);

  // File loading state
  const [files, setFiles] = useState<FileNode[]>([]);

  // Event detail modal state
  const [selectedEvent, setSelectedEvent] = useState<{
    event: unknown;
    label: string;
    type: string;
  } | null>(null);

  const activeTab = (["chat", "trace", "files", "todos"].includes(tab) ? tab : "chat") as TabId;
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
      agentState as { todos?: Array<{ content: string; status: string }> } | null
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

  // Load files for the current agent
  const loadFiles = useCallback(async () => {
    try {
      const fileNodes: FileNode[] = [];

      // Load /shared/ directory (agency-wide)
      try {
        const { entries: sharedEntries } = await listDirectory("shared");
        const sharedChildren = await buildFileTree(
          sharedEntries,
          "shared",
          listDirectory,
          readFile
        );
        fileNodes.push({
          id: "dir-shared",
          name: "shared",
          type: "directory",
          children: sharedChildren,
        });
      } catch {
        fileNodes.push({
          id: "dir-shared",
          name: "shared",
          type: "directory",
          children: [],
        });
      }

      // Load current agent's directory as ~/ (home)
      try {
        const agentPath = `agents/${agentId}`;
        const { entries: agentEntries } = await listDirectory(agentPath);
        const filteredEntries = agentEntries.filter((e) => {
          const cleanPath = e.path.replace(/\/+$/, "");
          return cleanPath !== agentPath && cleanPath !== `/${agentPath}`;
        });
        const agentChildren = await buildFileTree(
          filteredEntries,
          agentPath,
          listDirectory,
          readFile
        );
        fileNodes.push({
          id: "dir-home",
          name: "~",
          type: "directory",
          children: agentChildren,
        });
      } catch {
        fileNodes.push({
          id: "dir-home",
          name: "~",
          type: "directory",
          children: [],
        });
      }

      setFiles(fileNodes);
    } catch (e) {
      console.error("Failed to load files:", e);
    }
  }, [agentId, listDirectory, readFile]);

  useEffect(() => {
    if (activeTab === "files") {
      loadFiles();
    }
  }, [activeTab, loadFiles]);

  const handleSendMessage = async (content: string) => {
    await sendMessage(content);
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
        return <FilesView files={files} loadFileContent={readFile} />;
      case "todos":
        return <TodosView todos={todos} />;
      default:
        return null;
    }
  };

  if (!selectedAgent) {
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
    </>
  );
}

// ============================================================================
// Settings View Wrapper (handles /:agencyId/settings)
// ============================================================================

function SettingsRoute({ agencyId }: { agencyId: string }) {
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
  } = useAgency(agencyId);
  const { agencies } = useAgencies();
  const { plugins, tools } = usePlugins();
  const agency = agencies.find((a) => a.id === agencyId);

  return (
    <>
      <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Agency Settings
        </h1>
        <p className="text-sm text-neutral-500">
          {agency?.name || "Unknown agency"}
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
          plugins={plugins}
          tools={tools}
        />
      </div>
    </>
  );
}

// ============================================================================
// Empty State (no agent selected)
// ============================================================================

function EmptyState({ hasAgency, hasAgents }: { hasAgency?: boolean; hasAgents?: boolean }) {
  if (!hasAgency) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <Robot size={32} className="text-orange-500" />
          </div>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Welcome to Agent Hub
          </h2>
          <p className="text-neutral-500 dark:text-neutral-400 mb-4">
            Select an agency from the sidebar to get started, or create a new one.
          </p>
        </div>
      </div>
    );
  }
  
  if (!hasAgents) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <Plus size={32} className="text-neutral-400" />
          </div>
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            No agents yet
          </h2>
          <p className="text-neutral-500 dark:text-neutral-400 mb-4">
            Create your first agent to start a conversation. Click "New Agent" in the sidebar.
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md px-4">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
          <ChatCircle size={32} className="text-neutral-400" />
        </div>
        <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
          Select an agent
        </h2>
        <p className="text-neutral-500 dark:text-neutral-400">
          Choose an agent from the sidebar to view its conversation and details.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Main Content Router
// ============================================================================

function MainContent({ agencyId, hasAgents }: { agencyId: string | null; hasAgents: boolean }) {
  // Match agent routes
  const [matchAgent, paramsAgent] = useRoute("/:agencyId/agent/:agentId");
  const [matchAgentTab, paramsAgentTab] = useRoute("/:agencyId/agent/:agentId/:tab");
  const [matchSettings] = useRoute("/:agencyId/settings");

  if (!agencyId) {
    return <EmptyState hasAgency={false} />;
  }

  if (matchSettings) {
    return <SettingsRoute agencyId={agencyId} />;
  }

  if (matchAgentTab && paramsAgentTab) {
    return (
      <AgentView
        agencyId={agencyId}
        agentId={paramsAgentTab.agentId}
        tab={paramsAgentTab.tab}
      />
    );
  }

  if (matchAgent && paramsAgent) {
    return (
      <AgentView
        agencyId={agencyId}
        agentId={paramsAgent.agentId}
      />
    );
  }

  return <EmptyState hasAgency={true} hasAgents={hasAgents} />;
}

// ============================================================================
// App Component
// ============================================================================

export default function App() {
  const [location, navigate] = useLocation();

  // Auth state - check if we need to show unlock form
  const [isLocked, setIsLocked] = useState(false);
  const [authError, setAuthError] = useState<string | undefined>();

  // Parse agencyId and agentId from URL
  const pathParts = location.split("/").filter(Boolean);
  const agencyId = pathParts[0] || null;
  const agentId = pathParts[1] === "agent" ? pathParts[2] || null : null;

  // Data hooks
  const { agencies, create: createAgency, error: agenciesError } = useAgencies();
  const { agents, blueprints, spawnAgent } = useAgency(agencyId);
  const { run: runState } = useAgent(agencyId, agentId);

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

  // Show auth unlock form if locked
  if (isLocked) {
    return <AuthUnlockForm onUnlock={handleUnlock} error={authError} />;
  }

  return (
    <div className="h-screen flex bg-neutral-50 dark:bg-neutral-950">
      {/* Sidebar */}
      <Sidebar
        agencies={agencies}
        selectedAgencyId={agencyId}
        onCreateAgency={handleCreateAgency}
        agents={agents}
        selectedAgentId={agentId}
        onCreateAgent={() => handleCreateAgent()}
        agentStatus={agentStatus}
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
        <MainContent agencyId={agencyId} hasAgents={agents.length > 0} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
