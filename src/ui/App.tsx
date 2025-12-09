import { useState, useMemo, useEffect, useCallback, StrictMode } from "react";
import {
  Sidebar,
  ContentHeader,
  ChatView,
  TraceView,
  FilesView,
  TodosView,
  SettingsView,
  type TabId,
  type Message,
  type FileNode,
  type Todo,
} from "./components";
import { useAgencies, useAgency, useAgent } from "./hooks";
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
// Mock Data
// ============================================================================

const MOCK_AGENCIES = [
  { id: "agency-1", name: "My Agency", createdAt: new Date().toISOString() },
  { id: "agency-2", name: "Test Agency", createdAt: new Date().toISOString() },
];

const MOCK_AGENTS = [
  {
    id: "agent-abc123def456",
    agentType: "research_agent",
    createdAt: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: "agent-xyz789ghi012",
    agentType: "code_reviewer",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

const MOCK_MESSAGES: Message[] = [
  {
    id: "msg-1",
    role: "system",
    content: "Conversation started",
    timestamp: new Date(Date.now() - 600000).toISOString(),
  },
  {
    id: "msg-2",
    role: "user",
    content: "Can you help me analyze the sales data from Q3?",
    timestamp: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: "msg-3",
    role: "assistant",
    content:
      "I'd be happy to help analyze the Q3 sales data. Let me fetch the relevant files.",
    timestamp: new Date(Date.now() - 290000).toISOString(),
    toolCalls: [
      {
        id: "tool-1",
        name: "read_file",
        args: { path: "/data/sales_q3.csv" },
        result: "Successfully read 1,247 rows",
        status: "done",
      },
    ],
  },
];

const MOCK_FILES: FileNode[] = [
  {
    id: "f1",
    name: "data",
    type: "directory",
    children: [
      {
        id: "f2",
        name: "sales_q3.csv",
        type: "file",
        size: 45200,
        content: "date,region,revenue\n2024-07-01,West,125000\n...",
      },
    ],
  },
];

const MOCK_TODOS: Todo[] = [
  {
    id: "td1",
    title: "Fetch Q3 sales data",
    status: "done",
    priority: "high",
    createdAt: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: "td2",
    title: "Run analysis",
    status: "in_progress",
    priority: "medium",
    createdAt: new Date(Date.now() - 200000).toISOString(),
  },
];

// ============================================================================
// App Component
// ============================================================================

export default function App() {
  // Selection state
  const [selectedAgencyId, setSelectedAgencyId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const [showSettings, setShowSettings] = useState(false);

  // Real data hooks
  const { agencies: realAgencies, create: createAgency } = useAgencies();
  const {
    agents: realAgents,
    blueprints,
    schedules,
    vars,
    spawnAgent,
    listDirectory,
    readFile,
    refreshSchedules,
    createSchedule,
    deleteSchedule,
    pauseSchedule,
    resumeSchedule,
    triggerSchedule,
    getScheduleRuns,
    setVar,
    deleteVar,
  } = useAgency(selectedAgencyId);
  const {
    state: agentState,
    run: runState,
    events,
    sendMessage,
    cancel,
    loading: agentLoading,
  } = useAgent(selectedAgencyId, selectedAgentId);

  // File loading state
  const [files, setFiles] = useState<FileNode[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);

  // Blueprint picker state
  const [showBlueprintPicker, setShowBlueprintPicker] = useState(false);

  // Agency creation modal state
  const [showAgencyModal, setShowAgencyModal] = useState(false);
  const [newAgencyName, setNewAgencyName] = useState("");

  // Event detail modal state
  const [selectedEvent, setSelectedEvent] = useState<{
    event: unknown;
    label: string;
    type: string;
  } | null>(null);

  // Use mock or real data
  const agencies = realAgencies;
  const agents = realAgents;

  // Mock message state for demo
  const [mockMessages, setMockMessages] = useState<Message[]>(MOCK_MESSAGES);
  const [mockLoading, setMockLoading] = useState(false);

  // Get messages from agent state or mock
  const messages = useMemo(() => {
    return convertChatMessages(agentState?.messages || []);
  }, [agentState?.messages]);

  const isLoading = agentLoading;

  // Get selected agent info
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const selectedAgency = agencies.find((a) => a.id === selectedAgencyId);

  // Derive status from run state
  const threadStatus = useMemo(() => {
    const status: Record<
      string,
      "running" | "paused" | "done" | "error" | "idle"
    > = {};
    agents.forEach((a) => {
      if (a.id === selectedAgentId && runState) {
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
  }, [agents, selectedAgentId, runState]);

  // Handlers
  const handleSendMessage = async (content: string) => {
    await sendMessage(content);
  };

  const handleCreateAgency = async (name?: string) => {
    if (name) {
      const agency = await createAgency(name);
      setSelectedAgencyId(agency.id);
      setShowAgencyModal(false);
      setNewAgencyName("");
    } else {
      setShowAgencyModal(true);
    }
  };

  const handleCreateAgent = async (agentType?: string) => {
    if (agentType) {
      const agent = await spawnAgent(agentType);
      setSelectedAgentId(agent.id);
      setShowBlueprintPicker(false);
    } else {
      // Show blueprint picker
      setShowBlueprintPicker(true);
    }
  };

  // Load files for the current agent
  // Shows /shared/ (agency-wide) and ~/ (current agent's folder)
  const loadFiles = useCallback(async () => {
    if (!selectedAgencyId || !selectedAgentId) return;
    setFilesLoading(true);
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
        // shared directory might not exist yet
        fileNodes.push({
          id: "dir-shared",
          name: "shared",
          type: "directory",
          children: [],
        });
      }

      // Load current agent's directory as ~/ (home)
      try {
        const agentPath = `agents/${selectedAgentId}`;
        const { entries: agentEntries } = await listDirectory(agentPath);

        // Filter out the agent folder entry itself (API may return it)
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
        // agent directory might not exist yet
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
    } finally {
      setFilesLoading(false);
    }
  }, [selectedAgencyId, selectedAgentId, listDirectory, readFile]);

  useEffect(() => {
    if (activeTab === "files") {
      loadFiles();
    }
  }, [activeTab, loadFiles]);

  // Derive todos from agent state (planning middleware adds state.todos)
  const todos = useMemo((): Todo[] => {
    // Planning middleware adds `todos` to state
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

  // Render content based on active tab
  const renderContent = () => {
    if (!selectedAgent) {
      return (
        <div className="flex-1 flex items-center justify-center text-neutral-400">
          <p className="text-lg">Select an agent to get started</p>
        </div>
      );
    }

    switch (activeTab) {
      case "chat":
        return (
          <ChatView
            messages={messages}
            onSendMessage={handleSendMessage}
            onStop={cancel}
            isLoading={isLoading}
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

  return (
    <div className="h-screen flex bg-neutral-50 dark:bg-neutral-950">
      {/* Sidebar */}
      <Sidebar
        agencies={agencies}
        selectedAgencyId={selectedAgencyId}
        onSelectAgency={setSelectedAgencyId}
        onCreateAgency={handleCreateAgency}
        threads={agents}
        selectedThreadId={selectedAgentId}
        onSelectThread={(id) => {
          setSelectedAgentId(id);
          setShowSettings(false);
        }}
        onCreateThread={() => handleCreateAgent()}
        onOpenSettings={() => {
          setShowSettings(true);
          setSelectedAgentId(null);
        }}
        threadStatus={threadStatus}
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

      {/* Event detail modal */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent.event}
          label={selectedEvent.label}
          type={selectedEvent.type}
          onClose={() => setSelectedEvent(null)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {showSettings ? (
          // Settings view (agency-level)
          <>
            <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Agency Settings
              </h1>
              <p className="text-sm text-neutral-500">
                {selectedAgency?.name || "Select an agency"}
              </p>
            </div>
            <div className="flex-1 overflow-hidden">
              <SettingsView
                agencyId={selectedAgencyId}
                agencyName={selectedAgency?.name}
                blueprints={blueprints}
                schedules={schedules}
                vars={vars}
                onCreateSchedule={createSchedule}
                onDeleteSchedule={deleteSchedule}
                onPauseSchedule={pauseSchedule}
                onResumeSchedule={resumeSchedule}
                onTriggerSchedule={triggerSchedule}
                onGetScheduleRuns={getScheduleRuns}
                onRefreshSchedules={refreshSchedules}
                onSetVar={setVar}
                onDeleteVar={deleteVar}
              />
            </div>
          </>
        ) : (
          // Agent view with tabs
          <>
            {selectedAgent && (
              <ContentHeader
                threadName={selectedAgent.agentType}
                threadId={selectedAgent.id}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                status={threadStatus[selectedAgent.id]}
              />
            )}
            <div className="flex-1 flex flex-col overflow-hidden">
              {renderContent()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
