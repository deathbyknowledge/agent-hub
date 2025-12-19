import { useState, useEffect, useCallback, useRef } from "react";
import {
  AgentHubClient,
  AgencyClient,
  AgentClient,
  type AgencyMeta,
  type AgentSummary,
  type AgentBlueprint,
  type AgentSchedule,
  type ScheduleRun,
  type CreateScheduleRequest,
  type ChatMessage,
  type AgentState,
  type RunState,
  type AgentEvent,
  type WebSocketEvent,
  type PluginInfo,
  type ToolInfo,
} from "@client";

// Get base URL from current location
function getBaseUrl(): string {
  return window.location.origin;
}

// Get secret from localStorage
export function getStoredSecret(): string | undefined {
  const secret = localStorage.getItem("hub_secret");
  return secret || undefined;
}

// Set secret in localStorage
export function setStoredSecret(secret: string): void {
  localStorage.setItem("hub_secret", secret);
  // Reset the client so it picks up the new secret
  clientInstance = null;
}

// Clear secret from localStorage
export function clearStoredSecret(): void {
  localStorage.removeItem("hub_secret");
  clientInstance = null;
}

// Singleton client instance
let clientInstance: AgentHubClient | null = null;

export function getClient(): AgentHubClient {
  if (!clientInstance) {
    clientInstance = new AgentHubClient({
      baseUrl: getBaseUrl(),
      secret: getStoredSecret(),
    });
  }
  return clientInstance;
}

// ============================================================================
// useAgencies - List and manage agencies
// ============================================================================

export function useAgencies() {
  const [agencies, setAgencies] = useState<AgencyMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = getClient();
      const { agencies } = await client.listAgencies();
      setAgencies(agencies);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async (name?: string) => {
    const client = getClient();
    const agency = await client.createAgency({ name });
    setAgencies((prev) => [...prev, agency]);
    return agency;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { agencies, loading, error, refresh, create };
}

// ============================================================================
// useVarHints - Get plugin var hints
// ============================================================================

export function usePlugins() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const client = getClient();
      const { plugins, tools } = await client.getPlugins();
      setPlugins(plugins);
      setTools(tools);
    } catch (e) {
      console.error("Failed to fetch plugins:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { plugins, tools, loading, refresh };
}

// ============================================================================
// useAgency - Work with a specific agency
// ============================================================================

export type MemoryDisk = {
  name: string;
  description?: string;
  size?: number;
};

export function useAgency(agencyId: string | null) {
  const [agencyClient, setAgencyClient] = useState<AgencyClient | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [blueprints, setBlueprints] = useState<AgentBlueprint[]>([]);
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [vars, setVars] = useState<Record<string, unknown>>({});
  const [memoryDisks, setMemoryDisks] = useState<MemoryDisk[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Update agency client when ID changes
  useEffect(() => {
    if (agencyId) {
      const client = getClient();
      setAgencyClient(client.agency(agencyId));
    } else {
      setAgencyClient(null);
      setAgents([]);
      setBlueprints([]);
    }
  }, [agencyId]);

  // Fetch agents when agency client changes
  const refreshAgents = useCallback(async () => {
    if (!agencyClient) return;
    setLoading(true);
    setError(null);
    try {
      const { agents } = await agencyClient.listAgents();
      setAgents(agents);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [agencyClient]);

  // Fetch blueprints
  const refreshBlueprints = useCallback(async () => {
    if (!agencyClient) return;
    try {
      const { blueprints } = await agencyClient.listBlueprints();
      setBlueprints(blueprints);
    } catch (e) {
      console.error("Failed to fetch blueprints:", e);
    }
  }, [agencyClient]);

  // Fetch schedules
  const refreshSchedules = useCallback(async () => {
    if (!agencyClient) return;
    try {
      const { schedules } = await agencyClient.listSchedules();
      setSchedules(schedules);
    } catch (e) {
      console.error("Failed to fetch schedules:", e);
    }
  }, [agencyClient]);

  // Fetch vars
  const refreshVars = useCallback(async () => {
    if (!agencyClient) return;
    try {
      const { vars } = await agencyClient.getVars();
      setVars(vars);
    } catch (e) {
      console.error("Failed to fetch vars:", e);
    }
  }, [agencyClient]);

  // Fetch memory disks
  const refreshMemoryDisks = useCallback(async () => {
    if (!agencyClient) return;
    try {
      const { entries } = await agencyClient.listDirectory("/shared/memories");
      const disks: MemoryDisk[] = [];
      for (const entry of entries) {
        if (entry.type === "file" && entry.path.endsWith(".idz")) {
          const name = entry.path.replace(/.*\//, "").replace(/\.idz$/, "");
          // Try to read the file to get description and size
          try {
            const { content } = await agencyClient.readFile(entry.path);
            const data = JSON.parse(content) as { description?: string; entries?: unknown[] };
            disks.push({
              name,
              description: data.description,
              size: data.entries?.length,
            });
          } catch {
            disks.push({ name });
          }
        }
      }
      setMemoryDisks(disks);
    } catch {
      // Directory might not exist yet
      setMemoryDisks([]);
    }
  }, [agencyClient]);

  useEffect(() => {
    if (agencyClient) {
      refreshAgents();
      refreshBlueprints();
      refreshSchedules();
      refreshVars();
      refreshMemoryDisks();
    }
  }, [agencyClient, refreshAgents, refreshBlueprints, refreshSchedules, refreshVars, refreshMemoryDisks]);

  const spawnAgent = useCallback(
    async (agentType: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      const agent = await agencyClient.spawnAgent({ agentType });
      // Refresh the list to get the new agent
      await refreshAgents();
      return agent;
    },
    [agencyClient, refreshAgents]
  );

  // Filesystem operations
  const listDirectory = useCallback(
    async (path: string = "/") => {
      if (!agencyClient) throw new Error("No agency selected");
      return agencyClient.listDirectory(path);
    },
    [agencyClient]
  );

  const readFile = useCallback(
    async (path: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      return agencyClient.readFile(path);
    },
    [agencyClient]
  );

  // Schedule operations
  const createSchedule = useCallback(
    async (request: CreateScheduleRequest) => {
      if (!agencyClient) throw new Error("No agency selected");
      const { schedule } = await agencyClient.createSchedule(request);
      await refreshSchedules();
      return schedule;
    },
    [agencyClient, refreshSchedules]
  );

  const deleteSchedule = useCallback(
    async (scheduleId: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.deleteSchedule(scheduleId);
      await refreshSchedules();
    },
    [agencyClient, refreshSchedules]
  );

  const pauseSchedule = useCallback(
    async (scheduleId: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.pauseSchedule(scheduleId);
      await refreshSchedules();
    },
    [agencyClient, refreshSchedules]
  );

  const resumeSchedule = useCallback(
    async (scheduleId: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.resumeSchedule(scheduleId);
      await refreshSchedules();
    },
    [agencyClient, refreshSchedules]
  );

  const triggerSchedule = useCallback(
    async (scheduleId: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      const { run } = await agencyClient.triggerSchedule(scheduleId);
      return run;
    },
    [agencyClient]
  );

  const getScheduleRuns = useCallback(
    async (scheduleId: string): Promise<ScheduleRun[]> => {
      if (!agencyClient) throw new Error("No agency selected");
      const { runs } = await agencyClient.getScheduleRuns(scheduleId);
      return runs;
    },
    [agencyClient]
  );

  // Vars operations
  const setVar = useCallback(
    async (key: string, value: unknown) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.setVar(key, value);
      await refreshVars();
    },
    [agencyClient, refreshVars]
  );

  const deleteVar = useCallback(
    async (key: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.deleteVar(key);
      await refreshVars();
    },
    [agencyClient, refreshVars]
  );

  // Memory disk operations
  const createMemoryDisk = useCallback(
    async (name: string, description?: string, entries?: string[]) => {
      if (!agencyClient) throw new Error("No agency selected");
      const idz = {
        version: 1,
        name,
        description,
        hasEmbeddings: false,
        entries: entries?.map((content) => ({ content })) ?? [],
      };
      await agencyClient.writeFile(`/shared/memories/${name}.idz`, JSON.stringify(idz));
      await refreshMemoryDisks();
    },
    [agencyClient, refreshMemoryDisks]
  );

  const importMemoryDisk = useCallback(
    async (file: File) => {
      if (!agencyClient) throw new Error("No agency selected");
      const content = await file.text();
      // Validate it's valid JSON
      const data = JSON.parse(content) as { name?: string };
      const name = data.name || file.name.replace(/\.(idz|json)$/, "");
      await agencyClient.writeFile(`/shared/memories/${name}.idz`, content);
      await refreshMemoryDisks();
    },
    [agencyClient, refreshMemoryDisks]
  );

  const deleteMemoryDisk = useCallback(
    async (name: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.deleteFile(`/shared/memories/${name}.idz`);
      await refreshMemoryDisks();
    },
    [agencyClient, refreshMemoryDisks]
  );

  const createBlueprint = useCallback(
    async (blueprint: Omit<AgentBlueprint, "createdAt" | "updatedAt">) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.createBlueprint(blueprint);
      await refreshBlueprints();
    },
    [agencyClient, refreshBlueprints]
  );

  const updateBlueprint = useCallback(
    async (blueprint: AgentBlueprint) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.createBlueprint(blueprint);
      await refreshBlueprints();
    },
    [agencyClient, refreshBlueprints]
  );

  const deleteBlueprint = useCallback(
    async (name: string) => {
      if (!agencyClient) throw new Error("No agency selected");
      await agencyClient.deleteBlueprint(name);
      await refreshBlueprints();
    },
    [agencyClient, refreshBlueprints]
  );

  return {
    agencyClient,
    agents,
    blueprints,
    schedules,
    vars,
    loading,
    error,
    refreshAgents,
    refreshBlueprints,
    refreshSchedules,
    spawnAgent,
    listDirectory,
    readFile,
    createSchedule,
    deleteSchedule,
    pauseSchedule,
    resumeSchedule,
    triggerSchedule,
    getScheduleRuns,
    refreshVars,
    setVar,
    deleteVar,
    memoryDisks,
    refreshMemoryDisks,
    createMemoryDisk,
    importMemoryDisk,
    deleteMemoryDisk,
    createBlueprint,
    updateBlueprint,
    deleteBlueprint,
  };
}

// ============================================================================
// useAgent - Work with a specific agent (WebSocket + state)
// ============================================================================

interface AgentHookState {
  state: AgentState | null;
  run: RunState | null;
  events: AgentEvent[];
  connected: boolean;
  loading: boolean;
  error: Error | null;
}

export function useAgent(agencyId: string | null, agentId: string | null) {
  const [hookState, setHookState] = useState<AgentHookState>({
    state: null,
    run: null,
    events: [],
    connected: false,
    loading: false,
    error: null,
  });

  const agentClientRef = useRef<AgentClient | null>(null);
  const wsRef = useRef<{ close: () => void } | null>(null);

  // Create agent client when IDs change
  useEffect(() => {
    if (agencyId && agentId) {
      const client = getClient();
      agentClientRef.current = client.agency(agencyId).agent(agentId);
    } else {
      agentClientRef.current = null;
    }
  }, [agencyId, agentId]);

  // Fetch initial state
  const fetchState = useCallback(async () => {
    const agentClient = agentClientRef.current;
    if (!agentClient) return;

    setHookState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { state, run } = await agentClient.getState();
      setHookState((prev) => ({
        ...prev,
        state,
        run,
        loading: false,
      }));
    } catch (e) {
      setHookState((prev) => ({
        ...prev,
        error: e instanceof Error ? e : new Error(String(e)),
        loading: false,
      }));
    }
  }, []);

  // Fetch events (for trace view) - includes subagent events
  const fetchEvents = useCallback(async () => {
    const agentClient = agentClientRef.current;
    if (!agentClient || !agencyId || !agentId) return;

    try {
      const allEvents: AgentEvent[] = [];
      const fetchedThreads = new Set<string>();
      const client = getClient();

      // Helper to extract subagent IDs from events
      const extractSubagentIds = (events: AgentEvent[]): string[] => {
        const ids: string[] = [];
        for (const event of events) {
          if (event.type === "subagent.spawned") {
            const childId = (event.data as { childThreadId?: string })
              ?.childThreadId;
            if (childId) ids.push(childId);
          }
        }
        return ids;
      };

      // Recursively fetch events for a thread and its subagents
      const fetchThreadEvents = async (threadId: string): Promise<void> => {
        if (fetchedThreads.has(threadId)) return;
        fetchedThreads.add(threadId);

        try {
          const threadClient = client.agency(agencyId).agent(threadId);
          const { events } = await threadClient.getEvents();

          // Tag events with threadId and add to collection
          const taggedEvents = events.map((e) => ({
            ...e,
            threadId: e.threadId || threadId,
          }));
          allEvents.push(...taggedEvents);

          // Extract subagent IDs from events - this is the source of truth
          // since events contain the full history of spawned subagents
          const subagentIds = extractSubagentIds(taggedEvents);

          // Recursively fetch subagent events
          for (const subId of subagentIds) {
            await fetchThreadEvents(subId);
          }
        } catch (e) {
          // Subagent might still be initializing - skip silently
          // Its events will be fetched on next refresh
        }
      };

      // Start with the main agent
      await fetchThreadEvents(agentId);

      // Sort all events by timestamp
      allEvents.sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      );

      setHookState((prev) => ({ ...prev, events: allEvents }));
    } catch (e) {
      console.error("Failed to fetch events:", e);
    }
  }, [agencyId, agentId]);

  // Connect WebSocket
  const connect = useCallback(() => {
    const agentClient = agentClientRef.current;
    if (!agentClient) return;

    // Close existing connection
    wsRef.current?.close();

    const connection = agentClient.connect({
      onOpen: () => {
        setHookState((prev) => ({ ...prev, connected: true }));
      },
      onClose: () => {
        setHookState((prev) => ({ ...prev, connected: false }));
      },
      onError: (e) => {
        console.error("WebSocket error:", e);
      },
      onEvent: (event: WebSocketEvent) => {
        // Handle WebSocket events - refetch state and events
        console.log("WebSocket event:", event.type, event);
        fetchState();
        fetchEvents();
      },
    });

    wsRef.current = connection;
  }, [fetchState, fetchEvents]);

  // Disconnect on cleanup or ID change
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [agencyId, agentId]);

  // Auto-connect and fetch state when agent changes
  useEffect(() => {
    if (agentClientRef.current) {
      fetchState();
      fetchEvents();
      connect();
    } else {
      setHookState({
        state: null,
        run: null,
        events: [],
        connected: false,
        loading: false,
        error: null,
      });
    }
  }, [agencyId, agentId, fetchState, fetchEvents, connect]);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      const agentClient = agentClientRef.current;
      if (!agentClient) throw new Error("No agent selected");

      const message: ChatMessage = {
        role: "user",
        content,
      };

      // Optimistically add user message
      setHookState((prev) => {
        if (!prev.state) return prev;
        return {
          ...prev,
          state: {
            ...prev.state,
            messages: [...(prev.state.messages || []), message],
          },
        };
      });

      // Invoke agent
      await agentClient.invoke({ messages: [message] });

      // Refresh state to get the response
      // (WebSocket should handle real-time updates, but poll as fallback)
      setTimeout(fetchState, 500);
    },
    [fetchState]
  );

  // Cancel run
  const cancel = useCallback(async () => {
    const agentClient = agentClientRef.current;
    if (!agentClient) return;
    await agentClient.action("cancel");
    await fetchState();
  }, [fetchState]);

  // Approve tool calls
  const approve = useCallback(
    async (toolCallIds: string[], approved: boolean) => {
      const agentClient = agentClientRef.current;
      if (!agentClient) return;
      await agentClient.action("approve", { toolCallIds, approved });
      await fetchState();
    },
    [fetchState]
  );

  return {
    ...hookState,
    sendMessage,
    cancel,
    approve,
    refresh: fetchState,
    refreshEvents: fetchEvents,
    reconnect: connect,
  };
}
