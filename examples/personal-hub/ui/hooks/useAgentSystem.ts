import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AgentHubClient,
  AgentClient,
  type AgencyMeta,
  type AgentSummary,
  type AgentBlueprint,
  type ScheduleRun,
  type CreateScheduleRequest,
  type ChatMessage,
  type AgentState,
  type RunState,
  type AgentEvent,
  type WebSocketEvent,
  type AgencyWebSocketEvent,
  type AgencyWebSocket,
  type McpServerConfig,
  type AddMcpServerRequest,
} from "agents-hub/client";

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

// Query keys for cache management
export const queryKeys = {
  agencies: ["agencies"] as const,
  plugins: ["plugins"] as const,
  agents: (agencyId: string) => ["agents", agencyId] as const,
  blueprints: (agencyId: string) => ["blueprints", agencyId] as const,
  schedules: (agencyId: string) => ["schedules", agencyId] as const,
  vars: (agencyId: string) => ["vars", agencyId] as const,
  memoryDisks: (agencyId: string) => ["memoryDisks", agencyId] as const,
  mcpServers: (agencyId: string) => ["mcpServers", agencyId] as const,
  agentState: (agencyId: string, agentId: string) => ["agentState", agencyId, agentId] as const,
  agentEvents: (agencyId: string, agentId: string) => ["agentEvents", agencyId, agentId] as const,
};

// ============================================================================
// Agency WebSocket Manager - Single connection per agency for all agent events
// ============================================================================

type AgencyEventListener = (event: AgencyWebSocketEvent) => void;

interface AgencyWsManager {
  connection: AgencyWebSocket | null;
  listeners: Set<AgencyEventListener>;
  connecting: boolean;
}

const agencyWsManagers = new Map<string, AgencyWsManager>();

function getOrCreateAgencyWsManager(agencyId: string): AgencyWsManager {
  let manager = agencyWsManagers.get(agencyId);
  if (!manager) {
    manager = {
      connection: null,
      listeners: new Set(),
      connecting: false,
    };
    agencyWsManagers.set(agencyId, manager);
  }
  return manager;
}

function connectAgencyWs(agencyId: string): void {
  const manager = getOrCreateAgencyWsManager(agencyId);
  if (manager.connection || manager.connecting) return;

  manager.connecting = true;
  const client = getClient().agency(agencyId);
  
  const ws = client.connect({
    onOpen: () => {
      manager.connecting = false;
    },
    onEvent: (event) => {
      // Notify all listeners
      for (const listener of manager.listeners) {
        try {
          listener(event);
        } catch (e) {
          console.error("[AgencyWS] Listener error:", e);
        }
      }
    },
    onClose: () => {
      manager.connection = null;
      manager.connecting = false;
    },
    onError: () => {
      manager.connection = null;
      manager.connecting = false;
    },
  });

  manager.connection = ws;
}

function subscribeToAgencyEvents(
  agencyId: string,
  listener: AgencyEventListener
): () => void {
  const manager = getOrCreateAgencyWsManager(agencyId);
  manager.listeners.add(listener);
  
  // Ensure connection exists
  if (!manager.connection && !manager.connecting) {
    connectAgencyWs(agencyId);
  }

  // Return unsubscribe function
  return () => {
    manager.listeners.delete(listener);
    
    // If no more listeners, close connection
    if (manager.listeners.size === 0 && manager.connection) {
      manager.connection.close();
      manager.connection = null;
    }
  };
}

// ============================================================================
// useAgencies - List and manage agencies
// ============================================================================

export function useAgencies() {
  const queryClient = useQueryClient();

  const {
    data: agencies = [],
    isLoading: loading,
    error,
    isFetched,
  } = useQuery({
    queryKey: queryKeys.agencies,
    queryFn: async () => {
      const { agencies } = await getClient().listAgencies();
      return agencies;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name?: string) => {
      return getClient().createAgency({ name });
    },
    onSuccess: (newAgency) => {
      queryClient.setQueryData<AgencyMeta[]>(queryKeys.agencies, (old) =>
        old ? [...old, newAgency] : [newAgency]
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (agencyId: string) => {
      return getClient().deleteAgency(agencyId);
    },
    onSuccess: (_data, agencyId) => {
      queryClient.setQueryData<AgencyMeta[]>(queryKeys.agencies, (old) =>
        old ? old.filter((a) => a.id !== agencyId) : []
      );
    },
  });

  return {
    agencies,
    loading,
    error: error as Error | null,
    hasFetched: isFetched,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agencies }),
    create: createMutation.mutateAsync,
    deleteAgency: deleteMutation.mutateAsync,
  };
}

// ============================================================================
// usePlugins - Get plugin and tool info
// ============================================================================

export function usePlugins() {
  const { data, isLoading: loading } = useQuery({
    queryKey: queryKeys.plugins,
    queryFn: async () => getClient().getPlugins(),
  });

  return {
    plugins: data?.plugins ?? [],
    tools: data?.tools ?? [],
    loading,
  };
}

// ============================================================================
// useAgency - Work with a specific agency
// ============================================================================

export type MemoryDisk = {
  name: string;
  description?: string;
  size?: number;
};

async function fetchMemoryDisks(agencyId: string): Promise<MemoryDisk[]> {
  const client = getClient().agency(agencyId);
  try {
    const { entries } = await client.listDirectory("/shared/memories");
    const disks: MemoryDisk[] = [];
    for (const entry of entries) {
      if (entry.type === "file" && entry.path.endsWith(".idz")) {
        const name = entry.path.replace(/.*\//, "").replace(/\.idz$/, "");
        try {
          const { content } = await client.readFile(entry.path);
          const data = JSON.parse(content) as {
            description?: string;
            entries?: unknown[];
          };
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
    return disks;
  } catch {
    return [];
  }
}

// Special agent type for Agency Mind
const AGENCY_MIND_TYPE = "_agency-mind";

// Special agency and agent type for Hub Mind
const SYSTEM_AGENCY_ID = "_system";
const HUB_MIND_TYPE = "_hub-mind";

export function useAgency(agencyId: string | null) {
  const queryClient = useQueryClient();
  const client = useMemo(
    () => (agencyId ? getClient().agency(agencyId) : null),
    [agencyId]
  );

  // Stable function references for filesystem operations
  const listDirectory = useCallback(
    (path: string = "/") => client!.listDirectory(path),
    [client]
  );
  const readFile = useCallback(
    (path: string) => client!.readFile(path),
    [client]
  );
  const normalizeFsPath = useCallback(
    (path: string) => `/${path.replace(/^\/+/, "")}`.replace(/\/+/g, "/"),
    []
  );
  const isProtectedFile = useCallback(
    (path: string) => normalizeFsPath(path) === "/.agency.json",
    [normalizeFsPath]
  );
  const writeFile = useCallback(
    (path: string, content: string) => {
      if (isProtectedFile(path)) {
        return Promise.reject(new Error("`.agency.json` is read-only"));
      }
      return client!.writeFile(path, content);
    },
    [client, isProtectedFile]
  );
  const deleteFile = useCallback(
    (path: string) => {
      if (isProtectedFile(path)) {
        return Promise.reject(new Error("`.agency.json` is read-only"));
      }
      return client!.deleteFile(path);
    },
    [client, isProtectedFile]
  );

  // Queries
  const {
    data: agents = [],
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.agents(agencyId!),
    queryFn: async () => {
      const { agents } = await client!.listAgents();
      return agents;
    },
    enabled: !!agencyId,
  });

  const { data: blueprints = [] } = useQuery({
    queryKey: queryKeys.blueprints(agencyId!),
    queryFn: async () => {
      const { blueprints } = await client!.listBlueprints();
      return blueprints;
    },
    enabled: !!agencyId,
  });

  const { data: schedules = [] } = useQuery({
    queryKey: queryKeys.schedules(agencyId!),
    queryFn: async () => {
      const { schedules } = await client!.listSchedules();
      return schedules;
    },
    enabled: !!agencyId,
  });

  const { data: vars = {} } = useQuery({
    queryKey: queryKeys.vars(agencyId!),
    queryFn: async () => {
      const { vars } = await client!.getVars();
      return vars;
    },
    enabled: !!agencyId,
  });

  const { data: memoryDisks = [] } = useQuery({
    queryKey: queryKeys.memoryDisks(agencyId!),
    queryFn: () => fetchMemoryDisks(agencyId!),
    enabled: !!agencyId,
  });

  const { data: mcpServers = [] } = useQuery({
    queryKey: queryKeys.mcpServers(agencyId!),
    queryFn: async () => {
      const { servers } = await client!.listMcpServers();
      return servers;
    },
    enabled: !!agencyId,
  });

  // Subscribe to live MCP server updates via agency WebSocket
  useEffect(() => {
    if (!agencyId) return;

    const unsubscribe = subscribeToAgencyEvents(agencyId, (event) => {
      // The agents-sdk broadcasts MCP state changes as cf_agent_mcp_servers
      if (event.type === "cf_agent_mcp_servers" && "mcp" in event) {
        const mcpState = (event as { mcp: { servers: Record<string, unknown> } }).mcp;
        if (mcpState?.servers) {
          // Convert SDK's MCPServersState to our McpServerConfig array
          const servers: McpServerConfig[] = Object.entries(mcpState.servers).map(
            ([id, server]: [string, unknown]) => {
              const s = server as {
                name?: string;
                url?: string;
                status?: string;
                error?: string;
                authUrl?: string;
              };
              return {
                id,
                name: s.name || id,
                url: s.url || "",
                status: (s.status || "connecting") as McpServerConfig["status"],
                error: s.error,
                authUrl: s.authUrl,
              };
            }
          );
          queryClient.setQueryData(queryKeys.mcpServers(agencyId), servers);
        }
      }
    });

    return unsubscribe;
  }, [agencyId, queryClient]);

  // Mutations
  const spawnMutation = useMutation({
    mutationFn: async (agentType: string) => client!.spawnAgent({ agentType }),
    onSuccess: (newAgent) => {
      queryClient.setQueryData<AgentSummary[]>(
        queryKeys.agents(agencyId!),
        (old) => (old ? [...old, newAgent] : [newAgent])
      );
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async (request: CreateScheduleRequest) => {
      const { schedule } = await client!.createSchedule(request);
      return schedule;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedules(agencyId!),
      }),
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (scheduleId: string) => client!.deleteSchedule(scheduleId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedules(agencyId!),
      }),
  });

  const pauseScheduleMutation = useMutation({
    mutationFn: (scheduleId: string) => client!.pauseSchedule(scheduleId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedules(agencyId!),
      }),
  });

  const deleteAgentMutation = useMutation({
    mutationFn: (agentId: string) => client!.deleteAgent(agentId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agents(agencyId!) }),
  });

  const deleteAgencyMutation = useMutation({
    mutationFn: () => client!.deleteAgency(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agencies });
    },
  });

  const resumeScheduleMutation = useMutation({
    mutationFn: (scheduleId: string) => client!.resumeSchedule(scheduleId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedules(agencyId!),
      }),
  });

  const setVarMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      await client!.setVar(key, value);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.vars(agencyId!) }),
  });

  const deleteVarMutation = useMutation({
    mutationFn: (key: string) => client!.deleteVar(key),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.vars(agencyId!) }),
  });

  const createMemoryDiskMutation = useMutation({
    mutationFn: async ({
      name,
      description,
      entries,
    }: {
      name: string;
      description?: string;
      entries?: string[];
    }) => {
      const idz = {
        version: 1,
        name,
        description,
        hasEmbeddings: false,
        entries: entries?.map((content) => ({ content })) ?? [],
      };
      await client!.writeFile(
        `/shared/memories/${name}.idz`,
        JSON.stringify(idz)
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.memoryDisks(agencyId!),
      }),
  });

  const importMemoryDiskMutation = useMutation({
    mutationFn: async (file: File) => {
      const content = await file.text();
      const data = JSON.parse(content) as { name?: string };
      const name = data.name || file.name.replace(/\.(idz|json)$/, "");
      await client!.writeFile(`/shared/memories/${name}.idz`, content);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.memoryDisks(agencyId!),
      }),
  });

  const deleteMemoryDiskMutation = useMutation({
    mutationFn: (name: string) =>
      client!.deleteFile(`/shared/memories/${name}.idz`),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.memoryDisks(agencyId!),
      }),
  });

  const blueprintMutation = useMutation({
    mutationFn: (
      blueprint:
        | Omit<AgentBlueprint, "createdAt" | "updatedAt">
        | AgentBlueprint
    ) => client!.createBlueprint(blueprint),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.blueprints(agencyId!),
      }),
  });

  const deleteBlueprintMutation = useMutation({
    mutationFn: (name: string) => client!.deleteBlueprint(name),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.blueprints(agencyId!),
      }),
  });

  const addMcpServerMutation = useMutation({
    mutationFn: async (request: AddMcpServerRequest) => {
      const { server } = await client!.addMcpServer(request);
      return server;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.mcpServers(agencyId!),
      }),
  });

  const removeMcpServerMutation = useMutation({
    mutationFn: (serverId: string) => client!.removeMcpServer(serverId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.mcpServers(agencyId!),
      }),
  });

  const retryMcpServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      const { server } = await client!.retryMcpServer(serverId);
      return server;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.mcpServers(agencyId!),
      }),
  });

  /**
   * Send a message to a specific agent without needing a WebSocket connection.
   * Useful for the command center where we message multiple agents.
   */
  const sendMessageToAgent = useCallback(
    async (agentId: string, content: string) => {
      if (!client) throw new Error("No agency selected");
      const agentClient = client.agent(agentId);
      await agentClient.invoke({
        messages: [{ role: "user", content }],
      });
    },
    [client]
  );

  return {
    agents,
    blueprints,
    schedules,
    vars,
    memoryDisks,
    mcpServers,
    loading,
    error: error as Error | null,
    sendMessageToAgent,
    refreshAgents: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agents(agencyId!) }),
    refreshBlueprints: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.blueprints(agencyId!),
      }),
    refreshSchedules: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.schedules(agencyId!),
      }),
    refreshVars: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.vars(agencyId!) }),
    refreshMemoryDisks: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.memoryDisks(agencyId!),
      }),
    // Note: refreshMcpServers removed - MCP updates come live via agency WebSocket
    spawnAgent: spawnMutation.mutateAsync,
    listDirectory,
    readFile,
    writeFile,
    deleteFile,
    createSchedule: scheduleMutation.mutateAsync,
    deleteSchedule: deleteScheduleMutation.mutateAsync,
    pauseSchedule: pauseScheduleMutation.mutateAsync,
    resumeSchedule: resumeScheduleMutation.mutateAsync,
    triggerSchedule: async (scheduleId: string) => {
      const { run } = await client!.triggerSchedule(scheduleId);
      return run;
    },
    getScheduleRuns: async (scheduleId: string): Promise<ScheduleRun[]> => {
      const { runs } = await client!.getScheduleRuns(scheduleId);
      return runs;
    },
    deleteAgent: deleteAgentMutation.mutateAsync,
    deleteAgency: deleteAgencyMutation.mutateAsync,
    setVar: (key: string, value: unknown) =>
      setVarMutation.mutateAsync({ key, value }),
    deleteVar: deleteVarMutation.mutateAsync,
    createMemoryDisk: (
      name: string,
      description?: string,
      entries?: string[]
    ) => createMemoryDiskMutation.mutateAsync({ name, description, entries }),
    importMemoryDisk: importMemoryDiskMutation.mutateAsync,
    deleteMemoryDisk: deleteMemoryDiskMutation.mutateAsync,
    createBlueprint: blueprintMutation.mutateAsync,
    updateBlueprint: blueprintMutation.mutateAsync,
    deleteBlueprint: deleteBlueprintMutation.mutateAsync,
    addMcpServer: addMcpServerMutation.mutateAsync,
    removeMcpServer: removeMcpServerMutation.mutateAsync,
    retryMcpServer: retryMcpServerMutation.mutateAsync,
    /**
     * Get or create the Agency Mind agent for this agency.
     * Returns the agent ID of the existing or newly spawned mind.
     */
    getOrCreateMind: async (): Promise<string> => {
      if (!client) throw new Error("No agency selected");

      // Check if mind agent already exists
      const { agents: currentAgents } = await client.listAgents();
      const existingMind = currentAgents.find(
        (a) => a.agentType === AGENCY_MIND_TYPE
      );
      if (existingMind) return existingMind.id;

      // Spawn new mind agent
      const newMind = await client.spawnAgent({ agentType: AGENCY_MIND_TYPE });
      queryClient.setQueryData<AgentSummary[]>(
        queryKeys.agents(agencyId!),
        (old) => (old ? [...old, newMind] : [newMind])
      );
      return newMind.id;
    },
  };
}

// ============================================================================
// useAgent - Work with a specific agent (Agency WebSocket + incremental state)
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
  // Track which subagents we're monitoring (for trace view)
  const monitoredAgentsRef = useRef<Set<string>>(new Set());

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
            threadId,
          }));
          allEvents.push(...taggedEvents);

          // Extract subagent IDs from events - this is the source of truth
          // since events contain the full history of spawned subagents
          const subagentIds = extractSubagentIds(taggedEvents);

          // Recursively fetch subagent events
          for (const subId of subagentIds) {
            await fetchThreadEvents(subId);
          }
        } catch {
          // Subagent might still be initializing - skip silently
          // Its events will be fetched on next refresh
        }
      };

      // Start with the main agent
      await fetchThreadEvents(agentId);

      // Track all monitored agents for live updates
      monitoredAgentsRef.current = fetchedThreads;

      // Sort all events by timestamp
      allEvents.sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      );

      setHookState((prev) => ({ ...prev, events: allEvents }));
    } catch (e) {
      console.error("Failed to fetch events:", e);
    }
  }, [agencyId, agentId]);

  // Handle incoming events from agency WebSocket
  const handleAgencyEvent = useCallback((event: AgencyWebSocketEvent) => {
    if (!agentId) return;
    
    // Check if event is for this agent or one of its subagents
    const isRelevant = event.agentId === agentId || 
      monitoredAgentsRef.current.has(event.agentId);
    
    if (!isRelevant) return;

    // Update run state based on event type
    if (event.agentId === agentId) {
      if (event.type === "run.started") {
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "running", step: 0 } as RunState,
        }));
      } else if (event.type === "agent.completed") {
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "completed" } as RunState,
        }));
        // Fetch full state to get final messages
        fetchState();
      } else if (event.type === "agent.error") {
        setHookState((prev) => ({
          ...prev,
          run: { 
            ...prev.run, 
            status: "error",
            reason: (event.data as { error?: string })?.error,
          } as RunState,
        }));
      } else if (event.type === "run.tick") {
        const step = (event.data as { step?: number })?.step ?? 0;
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "running", step } as RunState,
        }));
      } else if (event.type === "run.paused") {
        setHookState((prev) => ({
          ...prev,
          run: { 
            ...prev.run, 
            status: "paused",
            reason: (event.data as { reason?: string })?.reason,
          } as RunState,
        }));
      } else if (event.type === "run.resumed") {
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "running" } as RunState,
        }));
      } else if (event.type === "run.canceled") {
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "canceled" } as RunState,
        }));
      }
    }

    // Append event to trace (for all relevant agents)
    // Cast to extend with threadId for display purposes
    setHookState((prev) => {
      const newEvent = {
        ...event,
        threadId: event.agentId,
      } as AgentEvent & { threadId: string };
      return {
        ...prev,
        events: [...prev.events, newEvent].sort(
          (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
        ),
      };
    });

    // If a subagent was spawned, add it to monitored list
    if (event.type === "subagent.spawned") {
      const childId = (event.data as { childThreadId?: string })?.childThreadId;
      if (childId) {
        monitoredAgentsRef.current.add(childId);
      }
    }

    // For model.completed, refresh state to get new messages
    if (event.type === "model.completed" && event.agentId === agentId) {
      fetchState();
    }
  }, [agentId, fetchState]);

  // Subscribe to agency WebSocket
  useEffect(() => {
    if (!agencyId || !agentId) {
      setHookState({
        state: null,
        run: null,
        events: [],
        connected: false,
        loading: false,
        error: null,
      });
      return;
    }

    // Fetch initial state and events
    fetchState();
    fetchEvents();

    // Subscribe to agency events
    setHookState((prev) => ({ ...prev, connected: true }));
    const unsubscribe = subscribeToAgencyEvents(agencyId, handleAgencyEvent);

    return () => {
      unsubscribe();
      setHookState((prev) => ({ ...prev, connected: false }));
      monitoredAgentsRef.current.clear();
    };
  }, [agencyId, agentId, fetchState, fetchEvents, handleAgencyEvent]);

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

      // Invoke agent - response will come via WebSocket events
      await agentClient.invoke({ messages: [message] });
    },
    []
  );

  // Cancel run
  const cancel = useCallback(async () => {
    const agentClient = agentClientRef.current;
    if (!agentClient) return;
    await agentClient.action("cancel");
  }, []);

  // Approve tool calls
  const approve = useCallback(
    async (toolCallIds: string[], approved: boolean) => {
      const agentClient = agentClientRef.current;
      if (!agentClient) return;
      await agentClient.action("approve", { toolCallIds, approved });
    },
    []
  );

  return {
    ...hookState,
    sendMessage,
    cancel,
    approve,
    refresh: fetchState,
    refreshEvents: fetchEvents,
    reconnect: () => {}, // No-op - agency WS handles reconnection
  };
}

// ============================================================================
// useActivityFeed - Aggregate activity across all agents in an agency
// ============================================================================

export interface ActivityItem {
  id: string;
  timestamp: string;
  type: "message" | "agent_event" | "system";
  from?: string;
  to?: string;
  content?: string;
  agentId?: string;
  agentType?: string;
  event?: string;
  details?: string;
  status?: "running" | "done" | "error";
}

export function useActivityFeed(agencyId: string | null) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // Track agent types for display
  const agentTypesRef = useRef<Map<string, string>>(new Map());

  // Fetch all agents and their states (initial load only)
  const fetchActivity = useCallback(async () => {
    if (!agencyId) {
      setItems([]);
      return;
    }

    setIsLoading(true);
    try {
      const client = getClient().agency(agencyId);
      const { agents } = await client.listAgents();

      const allItems: ActivityItem[] = [];

      // Build agent type lookup
      for (const agent of agents) {
        agentTypesRef.current.set(agent.id, agent.agentType);
      }

      // Fetch state for each agent
      for (const agent of agents) {
        try {
          const agentClient = client.agent(agent.id);
          const { state, run } = await agentClient.getState();

          // Convert messages to activity items
          if (state?.messages) {
            for (let i = 0; i < state.messages.length; i++) {
              const msg = state.messages[i];
              const ts = msg.ts || new Date().toISOString();

              if (msg.role === "user") {
                allItems.push({
                  id: `${agent.id}-msg-${i}`,
                  timestamp: ts,
                  type: "message",
                  from: "you",
                  to: agent.agentType,
                  content: (msg as { content?: string }).content || "",
                  agentId: agent.id,
                  agentType: agent.agentType,
                });
              } else if (msg.role === "assistant") {
                const content = (msg as { content?: string }).content;
                if (content) {
                  allItems.push({
                    id: `${agent.id}-msg-${i}`,
                    timestamp: ts,
                    type: "message",
                    from: agent.agentType,
                    content,
                    agentId: agent.id,
                    agentType: agent.agentType,
                    status: run?.status === "running" ? "running" : "done",
                  });
                }
              }
            }
          }

          // Add current run status if running
          if (run?.status === "running") {
            allItems.push({
              id: `${agent.id}-run`,
              timestamp: new Date().toISOString(),
              type: "agent_event",
              agentId: agent.id,
              agentType: agent.agentType,
              event: "Running",
              status: "running",
            });
          }
        } catch (e) {
          // Agent might be initializing
          console.warn(`Failed to fetch state for agent ${agent.id}:`, e);
        }
      }

      // Sort by timestamp
      allItems.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      setItems(allItems);
    } catch (e) {
      console.error("Failed to fetch activity:", e);
    } finally {
      setIsLoading(false);
    }
  }, [agencyId]);

  // Handle incoming events from agency WebSocket
  const handleAgencyEvent = useCallback((event: AgencyWebSocketEvent) => {
    const agentType = event.agentType || agentTypesRef.current.get(event.agentId) || "unknown";
    
    // Update agent type lookup
    if (event.agentType) {
      agentTypesRef.current.set(event.agentId, event.agentType);
    }

    // Add activity items based on event type
    if (event.type === "agent.completed") {
      setItems((prev) => {
        // Remove any "running" status item for this agent
        const filtered = prev.filter(
          (item) => !(item.id === `${event.agentId}-run` && item.status === "running")
        );
        return filtered;
      });
    } else if (event.type === "run.started") {
      setItems((prev) => [
        ...prev,
        {
          id: `${event.agentId}-run`,
          timestamp: event.ts,
          type: "agent_event",
          agentId: event.agentId,
          agentType,
          event: "Running",
          status: "running",
        },
      ]);
    } else if (event.type === "model.completed") {
      // A model response was generated - fetch latest state for this agent
      // to get the new message
      const client = getClient().agency(agencyId!);
      client.agent(event.agentId).getState().then(({ state }) => {
        if (!state?.messages?.length) return;
        
        const lastMsg = state.messages[state.messages.length - 1];
        if (lastMsg.role !== "assistant") return;
        
        const content = (lastMsg as { content?: string }).content;
        if (!content) return;

        setItems((prev) => {
          // Check if we already have this message
          const msgId = `${event.agentId}-msg-${state.messages.length - 1}`;
          if (prev.some((item) => item.id === msgId)) return prev;

          const newItem: ActivityItem = {
            id: msgId,
            timestamp: lastMsg.ts || event.ts,
            type: "message",
            from: agentType,
            content,
            agentId: event.agentId,
            agentType,
            status: "done",
          };
          return [...prev, newItem].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        });
      }).catch(() => {
        // Ignore errors - agent might be gone
      });
    }
  }, [agencyId]);

  // Subscribe to agency WebSocket
  useEffect(() => {
    if (!agencyId) {
      setItems([]);
      return;
    }

    // Initial fetch
    fetchActivity();

    // Subscribe to all agency events
    const unsubscribe = subscribeToAgencyEvents(agencyId, handleAgencyEvent);

    return unsubscribe;
  }, [agencyId, fetchActivity, handleAgencyEvent]);

  // Add a user message to the feed (optimistic update)
  const addUserMessage = useCallback((target: string, content: string, agentId: string) => {
    const newItem: ActivityItem = {
      id: `user-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "message",
      from: "you",
      to: target,
      content,
      agentId,
      agentType: target,
    };
    setItems((prev) => [...prev, newItem]);
    
    // Update agent type lookup
    agentTypesRef.current.set(agentId, target);
  }, []);

  // No longer needed - agency WS handles all agents automatically
  const subscribeToAgent = useCallback(
    (agentId: string, agentType?: string) => {
      if (agentType) {
        agentTypesRef.current.set(agentId, agentType);
      }
    },
    []
  );

  return {
    items,
    isLoading,
    refresh: fetchActivity,
    addUserMessage,
    subscribeToAgent,
  };
}

// ============================================================================
// useHubMind - Work with the Hub Mind (lives in _system agency)
// ============================================================================

interface HubMindHookState {
  hubMindId: string | null;
  isLoading: boolean;
  error: Error | null;
}

export function useHubMind() {
  const [hookState, setHookState] = useState<HubMindHookState>({
    hubMindId: null,
    isLoading: false,
    error: null,
  });

  /**
   * Get or create the Hub Mind agent.
   * This will:
   * 1. Create the _system agency if it doesn't exist
   * 2. Find or spawn a _hub-mind agent in it
   * 3. Set up the required vars (HUB_BASE_URL, HUB_SECRET)
   */
  const getOrCreateHubMind = useCallback(async (): Promise<string> => {
    setHookState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const client = getClient();

      // 1. Check if _system agency exists, create if not
      const { agencies } = await client.listAgencies();
      let systemAgency = agencies.find((a) => a.id === SYSTEM_AGENCY_ID);

      if (!systemAgency) {
        // Create the _system agency
        systemAgency = await client.createAgency({ name: SYSTEM_AGENCY_ID });
      }

      // 2. Get the _system agency client
      const systemClient = client.agency(SYSTEM_AGENCY_ID);

      // 3. Set up required vars for hub-management and memory plugins
      const baseUrl = window.location.origin;
      const secret = getStoredSecret();

      await systemClient.setVar("HUB_BASE_URL", baseUrl);
      if (secret) {
        await systemClient.setVar("HUB_SECRET", secret);
      }

      // Also set embedding vars if available in current agency
      // (Hub Mind needs these for memory plugin)
      // For now we'll use the same as LLM API (OpenAI compatible)
      const currentVars = await systemClient.getVars().catch(() => ({ vars: {} as Record<string, unknown> }));
      if (!(currentVars.vars as Record<string, unknown>).EMBEDDING_API_BASE) {
        // Default to OpenAI-compatible endpoint
        await systemClient.setVar("EMBEDDING_API_BASE", "https://api.openai.com/v1");
      }

      // 4. Check if hub-manual memory disk exists, create if not
      try {
        await systemClient.readFile("/shared/memories/hub-manual.idz");
      } catch {
        // Manual doesn't exist - create it with initial content
        const hubManual = {
          version: 1,
          name: "hub-manual",
          description: "Agent Hub system documentation and best practices",
          hasEmbeddings: false,
          entries: [
            { content: "Agent Hub is a framework for building multi-agent AI systems. It consists of agencies (containers for agents), blueprints (agent templates), and plugins (capability extensions). Each agency can have multiple agents running concurrently.", extra: { topic: "overview" } },
            { content: "A blueprint defines an agent type with: name (identifier), description (what it does), prompt (system instructions), capabilities (list of plugins/tools), and optional model override. Blueprints starting with _ are system blueprints and hidden from users.", extra: { topic: "blueprints" } },
            { content: "Capabilities in a blueprint can be: plugin names (e.g., 'planning', 'memory'), tool names (e.g., 'internet_search'), or tags with @ prefix (e.g., '@default' includes all default tools). Multiple capabilities can be combined.", extra: { topic: "capabilities" } },
            { content: "The planning plugin adds todo list management. Agents can create, update, and complete tasks. Best used for complex multi-step operations. Add 'planning' to capabilities to enable.", extra: { topic: "plugin", name: "planning" } },
            { content: "The memory plugin provides semantic search over .idz memory files. It requires EMBEDDING_API_BASE and EMBEDDING_API_KEY vars. Agents can recall (search) and remember (store) information. Add 'memory' to capabilities.", extra: { topic: "plugin", name: "memory" } },
            { content: "The filesystem plugin provides read/write access to the agency's R2-backed storage. Agents have a home directory (~/) and shared space (/shared/). Add 'filesystem' to capabilities.", extra: { topic: "plugin", name: "filesystem" } },
            { content: "The subagents plugin allows agents to spawn child agents for subtasks. Children report back to parents when done. Useful for parallel work or specialized tasks. Add 'subagents' to capabilities.", extra: { topic: "plugin", name: "subagents" } },
            { content: "Agency variables (vars) are key-value configuration accessible to all agents. Common vars: LLM_API_KEY, LLM_API_BASE, EMBEDDING_API_KEY, EMBEDDING_API_BASE, DEFAULT_MODEL. Set via Agency settings or API.", extra: { topic: "configuration" } },
            { content: "Schedules allow automatic agent spawning. Types: 'once' (single run at time), 'cron' (recurring pattern), 'interval' (every N milliseconds). Schedules can be paused, resumed, or manually triggered.", extra: { topic: "schedules" } },
            { content: "The Agency Mind (_agency-mind) is a special agent that manages its parent agency. It can list/create/update blueprints, manage agents, view schedules, and configure variables. Each agency has one.", extra: { topic: "system-agents" } },
            { content: "The Hub Mind (_hub-mind) is the top-level intelligence managing all agencies. It lives in the _system agency and can create/delete agencies, get hub-wide statistics, and provide guidance.", extra: { topic: "system-agents" } },
            { content: "Best practice for blueprint prompts: Be specific about the agent's role, list what it should and shouldn't do, mention available tools, and set expectations for output format.", extra: { topic: "best-practices" } },
            { content: "Best practice for capabilities: Start minimal and add as needed. '@default' gives common tools. Add 'planning' for complex tasks. Add 'memory' if the agent needs to remember across sessions.", extra: { topic: "best-practices" } },
            { content: "Memory disks are .idz files in /shared/memories/. They store entries with semantic embeddings for search. Create topic-specific disks like 'user-preferences', 'project-notes', 'learned-facts'.", extra: { topic: "memory-system" } },
          ],
        };
        await systemClient.writeFile("/shared/memories/hub-manual.idz", JSON.stringify(hubManual));
      }

      // 5. Check if hub mind agent already exists
      const { agents } = await systemClient.listAgents();
      const existingMind = agents.find((a) => a.agentType === HUB_MIND_TYPE);

      if (existingMind) {
        setHookState({ hubMindId: existingMind.id, isLoading: false, error: null });
        return existingMind.id;
      }

      // 5. Spawn new hub mind agent
      const newMind = await systemClient.spawnAgent({ agentType: HUB_MIND_TYPE });
      setHookState({ hubMindId: newMind.id, isLoading: false, error: null });
      return newMind.id;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setHookState((prev) => ({ ...prev, isLoading: false, error }));
      throw error;
    }
  }, []);

  return {
    ...hookState,
    systemAgencyId: SYSTEM_AGENCY_ID,
    getOrCreateHubMind,
  };
}

// ============================================================================
// useAgencyMetrics - Aggregated metrics with WebSocket updates
// ============================================================================

export interface AgencyMetrics {
  totalTokens: number;
  tokensByDay: Map<string, number>; // YYYY-MM-DD -> tokens
  runsCompleted: number;
  runsErrored: number;
  responseTimes: number[]; // ms for each model call
}

const EMPTY_METRICS: AgencyMetrics = {
  totalTokens: 0,
  tokensByDay: new Map(),
  runsCompleted: 0,
  runsErrored: 0,
  responseTimes: [],
};

/**
 * Hook to fetch and maintain agency-wide metrics.
 * 
 * Strategy:
 * 1. Initial load: Fetch all events from all agents once
 * 2. Agency WebSocket: Subscribe to all agent events, update metrics incrementally
 * 3. No polling: Metrics update in real-time via single agency WebSocket
 */
export function useAgencyMetrics(agencyId: string | null) {
  const [metrics, setMetrics] = useState<AgencyMetrics>(EMPTY_METRICS);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  
  // Track model.started timestamps for response time calculation
  const modelStartTimes = useRef<Map<string, number>>(new Map());

  // Process a single event and update metrics incrementally
  const processEvent = useCallback((event: AgencyWebSocketEvent) => {
    const eventDate = new Date(event.ts).toISOString().split("T")[0];
    const agentId = event.agentId;

    setMetrics((prev) => {
      const next = { ...prev, tokensByDay: new Map(prev.tokensByDay) };

      if (event.type === "model.completed") {
        const data = event.data as { usage?: { inputTokens: number; outputTokens: number } };
        if (data.usage) {
          const tokens = data.usage.inputTokens + data.usage.outputTokens;
          next.totalTokens += tokens;
          next.tokensByDay.set(eventDate, (next.tokensByDay.get(eventDate) || 0) + tokens);
        }

        // Calculate response time if we have a start time
        const startTime = modelStartTimes.current.get(agentId);
        if (startTime !== undefined) {
          const endTime = new Date(event.ts).getTime();
          next.responseTimes = [...prev.responseTimes, endTime - startTime];
          modelStartTimes.current.delete(agentId);
        }
      } else if (event.type === "model.started") {
        modelStartTimes.current.set(agentId, new Date(event.ts).getTime());
        return prev; // No state change needed
      } else if (event.type === "agent.completed") {
        next.runsCompleted = prev.runsCompleted + 1;
      } else if (event.type === "agent.error") {
        next.runsErrored = prev.runsErrored + 1;
      } else {
        return prev; // No relevant change
      }

      return next;
    });
  }, []);

  // Initial fetch of all historical events
  const fetchHistoricalMetrics = useCallback(async () => {
    if (!agencyId) {
      setMetrics(EMPTY_METRICS);
      setHasFetched(false);
      return;
    }

    setIsLoading(true);

    try {
      const client = getClient().agency(agencyId);
      const { agents } = await client.listAgents();

      // Reset metrics for fresh calculation
      let totalTokens = 0;
      const tokensByDay = new Map<string, number>();
      let runsCompleted = 0;
      let runsErrored = 0;
      const responseTimes: number[] = [];

      // Fetch events for each agent
      for (const agent of agents) {
        try {
          const agentClient = client.agent(agent.id);
          const { events } = await agentClient.getEvents();

          // Track model.started times for this agent's event history
          let agentModelStartTime: number | null = null;

          for (const event of events) {
            const eventDate = new Date(event.ts).toISOString().split("T")[0];

            if (event.type === "model.completed") {
              const data = event.data as { usage?: { inputTokens: number; outputTokens: number } };
              if (data.usage) {
                const tokens = data.usage.inputTokens + data.usage.outputTokens;
                totalTokens += tokens;
                tokensByDay.set(eventDate, (tokensByDay.get(eventDate) || 0) + tokens);
              }

              if (agentModelStartTime !== null) {
                const endTime = new Date(event.ts).getTime();
                responseTimes.push(endTime - agentModelStartTime);
                agentModelStartTime = null;
              }
            } else if (event.type === "model.started") {
              agentModelStartTime = new Date(event.ts).getTime();
            } else if (event.type === "agent.completed") {
              runsCompleted++;
            } else if (event.type === "agent.error") {
              runsErrored++;
            }
          }
        } catch {
          // Agent might be initializing, skip
        }
      }

      setMetrics({
        totalTokens,
        tokensByDay,
        runsCompleted,
        runsErrored,
        responseTimes,
      });
      setHasFetched(true);
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    } finally {
      setIsLoading(false);
    }
  }, [agencyId]);

  // Subscribe to agency WebSocket for live updates
  useEffect(() => {
    if (!agencyId) {
      setMetrics(EMPTY_METRICS);
      setHasFetched(false);
      return;
    }

    // Fetch historical metrics
    fetchHistoricalMetrics();

    // Subscribe to agency events for live updates
    const unsubscribe = subscribeToAgencyEvents(agencyId, processEvent);

    return () => {
      unsubscribe();
      modelStartTimes.current.clear();
    };
  }, [agencyId, fetchHistoricalMetrics, processEvent]);

  // No longer needed - agency WS automatically receives all agent events
  const subscribeToNewAgents = useCallback(() => {
    // No-op - agency WS handles all agents automatically
  }, []);

  return {
    metrics,
    isLoading,
    hasFetched,
    refresh: fetchHistoricalMetrics,
    subscribeToNewAgents,
  };
}
