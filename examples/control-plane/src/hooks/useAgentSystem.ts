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

// ============================================================================
// Hub Connection Storage - supports connecting to any remote hub
// ============================================================================

// Get hub URL from localStorage (for universal control plane)
export function getStoredHubUrl(): string | undefined {
  const url = localStorage.getItem("hub_url");
  return url || undefined;
}

// Set hub URL in localStorage
export function setStoredHubUrl(url: string): void {
  // Normalize URL - remove trailing slash
  const normalized = url.replace(/\/+$/, "");
  localStorage.setItem("hub_url", normalized);
  clientInstance = null;
  // Clear all WebSocket managers when hub changes
  agencyWsManagers.clear();
}

// Clear hub URL from localStorage
export function clearStoredHubUrl(): void {
  localStorage.removeItem("hub_url");
  clientInstance = null;
  agencyWsManagers.clear();
}

// Check if hub is configured
export function isHubConfigured(): boolean {
  return !!localStorage.getItem("hub_url");
}

// Get base URL - uses stored hub URL or falls back to current origin
function getBaseUrl(): string {
  return getStoredHubUrl() || window.location.origin;
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
type ConnectionStatusListener = (connected: boolean) => void;

// Reconnection configuration
const RECONNECT_BASE_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 30000; // 30 seconds
const RECONNECT_MAX_ATTEMPTS = 10;

interface AgencyWsManager {
  connection: AgencyWebSocket | null;
  listeners: Set<AgencyEventListener>;
  statusListeners: Set<ConnectionStatusListener>;
  connecting: boolean;
  reconnectAttempts: number;
  reconnectTimeout: ReturnType<typeof setTimeout> | null;
  intentionallyClosed: boolean;
}

const agencyWsManagers = new Map<string, AgencyWsManager>();

function getOrCreateAgencyWsManager(agencyId: string): AgencyWsManager {
  let manager = agencyWsManagers.get(agencyId);
  if (!manager) {
    manager = {
      connection: null,
      listeners: new Set(),
      statusListeners: new Set(),
      connecting: false,
      reconnectAttempts: 0,
      reconnectTimeout: null,
      intentionallyClosed: false,
    };
    agencyWsManagers.set(agencyId, manager);
  }
  return manager;
}

function notifyConnectionStatus(manager: AgencyWsManager, connected: boolean): void {
  for (const listener of manager.statusListeners) {
    try {
      listener(connected);
    } catch (e) {
      console.error("[AgencyWS] Status listener error:", e);
    }
  }
}

function scheduleReconnect(agencyId: string): void {
  const manager = getOrCreateAgencyWsManager(agencyId);
  
  // Don't reconnect if intentionally closed or no listeners
  if (manager.intentionallyClosed || manager.listeners.size === 0) {
    return;
  }
  
  // Don't reconnect if max attempts reached
  if (manager.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
    console.error(`[AgencyWS] Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached for agency ${agencyId}`);
    return;
  }
  
  // Calculate delay with exponential backoff
  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, manager.reconnectAttempts),
    RECONNECT_MAX_DELAY
  );
  
  console.log(`[AgencyWS] Scheduling reconnect for agency ${agencyId} in ${delay}ms (attempt ${manager.reconnectAttempts + 1})`);
  
  manager.reconnectTimeout = setTimeout(() => {
    manager.reconnectTimeout = null;
    manager.reconnectAttempts++;
    connectAgencyWs(agencyId);
  }, delay);
}

function connectAgencyWs(agencyId: string): void {
  const manager = getOrCreateAgencyWsManager(agencyId);
  if (manager.connection || manager.connecting) return;

  // Clear any pending reconnect
  if (manager.reconnectTimeout) {
    clearTimeout(manager.reconnectTimeout);
    manager.reconnectTimeout = null;
  }
  
  manager.connecting = true;
  manager.intentionallyClosed = false;
  const client = getClient().agency(agencyId);
  
  const ws = client.connect({
    onOpen: () => {
      manager.connecting = false;
      manager.reconnectAttempts = 0; // Reset on successful connection
      notifyConnectionStatus(manager, true);
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
      notifyConnectionStatus(manager, false);
      
      // Schedule reconnect if not intentionally closed
      if (!manager.intentionallyClosed) {
        scheduleReconnect(agencyId);
      }
    },
    onError: () => {
      manager.connection = null;
      manager.connecting = false;
      notifyConnectionStatus(manager, false);
      
      // Schedule reconnect
      if (!manager.intentionallyClosed) {
        scheduleReconnect(agencyId);
      }
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
    
    // If no more listeners, close connection and cleanup
    if (manager.listeners.size === 0) {
      manager.intentionallyClosed = true;
      
      // Clear any pending reconnect
      if (manager.reconnectTimeout) {
        clearTimeout(manager.reconnectTimeout);
        manager.reconnectTimeout = null;
      }
      
      if (manager.connection) {
        manager.connection.close();
        manager.connection = null;
      }
    }
  };
}

/**
 * Subscribe to connection status changes for an agency WebSocket
 */
function subscribeToConnectionStatus(
  agencyId: string,
  listener: ConnectionStatusListener
): () => void {
  const manager = getOrCreateAgencyWsManager(agencyId);
  manager.statusListeners.add(listener);
  
  // Immediately notify current status
  const isConnected = !!manager.connection && !manager.connecting;
  listener(isConnected);
  
  return () => {
    manager.statusListeners.delete(listener);
  };
}

/**
 * Get current connection status for an agency
 */
function getAgencyConnectionStatus(agencyId: string): { connected: boolean; reconnecting: boolean } {
  const manager = agencyWsManagers.get(agencyId);
  if (!manager) {
    return { connected: false, reconnecting: false };
  }
  return {
    connected: !!manager.connection && !manager.connecting,
    reconnecting: manager.reconnectAttempts > 0 && !manager.intentionallyClosed,
  };
}

/**
 * Manually trigger reconnection for an agency WebSocket
 */
function reconnectAgencyWs(agencyId: string): void {
  const manager = agencyWsManagers.get(agencyId);
  if (!manager) return;
  
  // Reset state for manual reconnect
  manager.intentionallyClosed = false;
  manager.reconnectAttempts = 0;
  
  // Clear any pending reconnect
  if (manager.reconnectTimeout) {
    clearTimeout(manager.reconnectTimeout);
    manager.reconnectTimeout = null;
  }
  
  // Close existing connection if any
  if (manager.connection) {
    manager.connection.close();
    manager.connection = null;
  }
  
  // Connect if there are listeners
  if (manager.listeners.size > 0) {
    connectAgencyWs(agencyId);
  }
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

export function useAgency(agencyId: string | null) {
  const queryClient = useQueryClient();
  const client = useMemo(
    () => (agencyId ? getClient().agency(agencyId) : null),
    [agencyId]
  );

  // Helper to get client with error if not available
  const requireClient = useCallback(() => {
    if (!client) throw new Error("No agency selected");
    return client;
  }, [client]);

  // Stable function references for filesystem operations
  const listDirectory = useCallback(
    (path: string = "/") => {
      if (!client) return Promise.reject(new Error("No agency selected"));
      return client.listDirectory(path);
    },
    [client]
  );
  const readFile = useCallback(
    (path: string) => {
      if (!client) return Promise.reject(new Error("No agency selected"));
      return client.readFile(path);
    },
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
      if (!client) return Promise.reject(new Error("No agency selected"));
      if (isProtectedFile(path)) {
        return Promise.reject(new Error("`.agency.json` is read-only"));
      }
      return client.writeFile(path, content);
    },
    [client, isProtectedFile]
  );
  const deleteFile = useCallback(
    (path: string) => {
      if (!client) return Promise.reject(new Error("No agency selected"));
      if (isProtectedFile(path)) {
        return Promise.reject(new Error("`.agency.json` is read-only"));
      }
      return client.deleteFile(path);
    },
    [client, isProtectedFile]
  );

  // Queries - enabled flag ensures client exists, but we add defensive checks
  const {
    data: agents = [],
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.agents(agencyId || "_none"),
    queryFn: async () => {
      if (!client) throw new Error("No agency selected");
      const { agents } = await client.listAgents();
      return agents;
    },
    enabled: !!agencyId && !!client,
  });

  const { data: blueprints = [] } = useQuery({
    queryKey: queryKeys.blueprints(agencyId || "_none"),
    queryFn: async () => {
      if (!client) throw new Error("No agency selected");
      const { blueprints } = await client.listBlueprints();
      return blueprints;
    },
    enabled: !!agencyId && !!client,
  });

  const { data: schedules = [] } = useQuery({
    queryKey: queryKeys.schedules(agencyId || "_none"),
    queryFn: async () => {
      if (!client) throw new Error("No agency selected");
      const { schedules } = await client.listSchedules();
      return schedules;
    },
    enabled: !!agencyId && !!client,
  });

  const { data: vars = {} } = useQuery({
    queryKey: queryKeys.vars(agencyId || "_none"),
    queryFn: async () => {
      if (!client) throw new Error("No agency selected");
      const { vars } = await client.getVars();
      return vars;
    },
    enabled: !!agencyId && !!client,
  });

  const { data: memoryDisks = [] } = useQuery({
    queryKey: queryKeys.memoryDisks(agencyId || "_none"),
    queryFn: () => {
      if (!agencyId) throw new Error("No agency selected");
      return fetchMemoryDisks(agencyId);
    },
    enabled: !!agencyId,
  });

  const { data: mcpServers = [] } = useQuery({
    queryKey: queryKeys.mcpServers(agencyId || "_none"),
    queryFn: async () => {
      if (!client) throw new Error("No agency selected");
      const { servers } = await client.listMcpServers();
      return servers;
    },
    enabled: !!agencyId && !!client,
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
                server_url?: string;
                state?: string;
                error?: string;
                auth_url?: string;
              };
              return {
                id,
                name: s.name || id,
                url: s.server_url || "",
                status: (s.state || "connecting") as McpServerConfig["status"],
                error: s.error,
                authUrl: s.auth_url,
              };
            }
          );
          queryClient.setQueryData(queryKeys.mcpServers(agencyId), servers);
        }
      }
    });

    return unsubscribe;
  }, [agencyId, queryClient]);

  // Mutations - all use requireClient() for safe client access
  const spawnMutation = useMutation({
    mutationFn: async (agentType: string) => requireClient().spawnAgent({ agentType }),
    onSuccess: (newAgent) => {
      if (!agencyId) return;
      // Prepend new agent to show at top (most recent first)
      queryClient.setQueryData<AgentSummary[]>(
        queryKeys.agents(agencyId),
        (old) => (old ? [newAgent, ...old] : [newAgent])
      );
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: async (request: CreateScheduleRequest) => {
      const { schedule } = await requireClient().createSchedule(request);
      return schedule;
    },
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(agencyId) });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (scheduleId: string) => requireClient().deleteSchedule(scheduleId),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(agencyId) });
    },
  });

  const pauseScheduleMutation = useMutation({
    mutationFn: (scheduleId: string) => requireClient().pauseSchedule(scheduleId),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(agencyId) });
    },
  });

  const deleteAgentMutation = useMutation({
    mutationFn: (agentId: string) => requireClient().deleteAgent(agentId),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.agents(agencyId) });
    },
  });

  const deleteAgencyMutation = useMutation({
    mutationFn: () => requireClient().deleteAgency(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.agencies });
    },
  });

  const resumeScheduleMutation = useMutation({
    mutationFn: (scheduleId: string) => requireClient().resumeSchedule(scheduleId),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.schedules(agencyId) });
    },
  });

  const setVarMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: unknown }) => {
      await requireClient().setVar(key, value);
    },
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.vars(agencyId) });
    },
  });

  const deleteVarMutation = useMutation({
    mutationFn: (key: string) => requireClient().deleteVar(key),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.vars(agencyId) });
    },
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
      await requireClient().writeFile(
        `/shared/memories/${name}.idz`,
        JSON.stringify(idz)
      );
    },
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.memoryDisks(agencyId) });
    },
  });

  const importMemoryDiskMutation = useMutation({
    mutationFn: async (file: File) => {
      const content = await file.text();
      const data = JSON.parse(content) as { name?: string };
      const name = data.name || file.name.replace(/\.(idz|json)$/, "");
      await requireClient().writeFile(`/shared/memories/${name}.idz`, content);
    },
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.memoryDisks(agencyId) });
    },
  });

  const deleteMemoryDiskMutation = useMutation({
    mutationFn: (name: string) =>
      requireClient().deleteFile(`/shared/memories/${name}.idz`),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.memoryDisks(agencyId) });
    },
  });

  const blueprintMutation = useMutation({
    mutationFn: (
      blueprint:
        | Omit<AgentBlueprint, "createdAt" | "updatedAt">
        | AgentBlueprint
    ) => requireClient().createBlueprint(blueprint),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.blueprints(agencyId) });
    },
  });

  const deleteBlueprintMutation = useMutation({
    mutationFn: (name: string) => requireClient().deleteBlueprint(name),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.blueprints(agencyId) });
    },
  });

  const addMcpServerMutation = useMutation({
    mutationFn: async (request: AddMcpServerRequest) => {
      const { server } = await requireClient().addMcpServer(request);
      return server;
    },
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers(agencyId) });
    },
  });

  const removeMcpServerMutation = useMutation({
    mutationFn: (serverId: string) => requireClient().removeMcpServer(serverId),
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers(agencyId) });
    },
  });

  const retryMcpServerMutation = useMutation({
    mutationFn: async (serverId: string) => {
      const { server } = await requireClient().retryMcpServer(serverId);
      return server;
    },
    onSuccess: () => {
      if (!agencyId) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers(agencyId) });
    },
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
    refreshAgents: () => {
      if (!agencyId) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: queryKeys.agents(agencyId) });
    },
    refreshBlueprints: () => {
      if (!agencyId) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: queryKeys.blueprints(agencyId) });
    },
    refreshSchedules: () => {
      if (!agencyId) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: queryKeys.schedules(agencyId) });
    },
    refreshVars: () => {
      if (!agencyId) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: queryKeys.vars(agencyId) });
    },
    refreshMemoryDisks: () => {
      if (!agencyId) return Promise.resolve();
      return queryClient.invalidateQueries({ queryKey: queryKeys.memoryDisks(agencyId) });
    },
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
      const { run } = await requireClient().triggerSchedule(scheduleId);
      return run;
    },
    getScheduleRuns: async (scheduleId: string): Promise<ScheduleRun[]> => {
      const { runs } = await requireClient().getScheduleRuns(scheduleId);
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
      if (event.type === "gen_ai.agent.invoked") {
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "running", step: 0 } as RunState,
        }));
      } else if (event.type === "gen_ai.agent.completed") {
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "completed" } as RunState,
        }));
      } else if (event.type === "gen_ai.agent.error") {
        setHookState((prev) => ({
          ...prev,
          run: { 
            ...prev.run, 
            status: "error",
            reason: (event.data as { "error.message"?: string })?.["error.message"],
          } as RunState,
        }));
      } else if (event.type === "gen_ai.agent.step") {
        const step = (event.data as { step?: number })?.step ?? 0;
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "running", step } as RunState,
        }));
      } else if (event.type === "gen_ai.agent.paused") {
        setHookState((prev) => ({
          ...prev,
          run: { 
            ...prev.run, 
            status: "paused",
            reason: (event.data as { reason?: string })?.reason,
          } as RunState,
        }));
      } else if (event.type === "gen_ai.agent.resumed") {
        setHookState((prev) => ({
          ...prev,
          run: { ...prev.run, status: "running" } as RunState,
        }));
      } else if (event.type === "gen_ai.agent.canceled") {
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

    // Handle gen_ai.content.message - add message incrementally (no fetch needed)
    if (event.type === "gen_ai.content.message" && event.agentId === agentId) {
      const data = event.data as {
        "gen_ai.content.text"?: string;
        "gen_ai.content.reasoning"?: string;
        "gen_ai.content.tool_calls"?: Array<{ id: string; name: string; arguments: unknown }>;
      };
      
      setHookState((prev) => {
        if (!prev.state) return prev;
        
        // Build the new assistant message
        const toolCalls = data["gen_ai.content.tool_calls"];
        const reasoning = data["gen_ai.content.reasoning"];
        const newMessage: ChatMessage = toolCalls?.length
          ? {
              role: "assistant" as const,
              toolCalls: toolCalls.map((tc: { id: string; name: string; arguments: unknown }) => ({
                id: tc.id,
                name: tc.name,
                args: tc.arguments,
              })),
              reasoning,
              ts: event.ts,
            }
          : {
              role: "assistant" as const,
              content: data["gen_ai.content.text"] || "",
              reasoning,
              ts: event.ts,
            };
        
        return {
          ...prev,
          state: {
            ...prev.state,
            messages: [...(prev.state.messages || []), newMessage],
          },
        };
      });
    }

    // Handle gen_ai.tool.finish - add tool result message incrementally
    if (event.type === "gen_ai.tool.finish" && event.agentId === agentId) {
      const data = event.data as {
        "gen_ai.tool.call.id": string;
        "gen_ai.tool.response"?: unknown;
      };
      
      setHookState((prev) => {
        if (!prev.state) return prev;
        
        const output = data["gen_ai.tool.response"];
        const toolMessage: ChatMessage = {
          role: "tool" as const,
          toolCallId: data["gen_ai.tool.call.id"],
          content: typeof output === "string" 
            ? output 
            : JSON.stringify(output),
          ts: event.ts,
        };
        
        return {
          ...prev,
          state: {
            ...prev.state,
            messages: [...(prev.state.messages || []), toolMessage],
          },
        };
      });
    }

    // Handle gen_ai.tool.error - add error result message incrementally
    if (event.type === "gen_ai.tool.error" && event.agentId === agentId) {
      const data = event.data as {
        "gen_ai.tool.call.id": string;
        "gen_ai.tool.name": string;
        "error.message"?: string;
      };
      
      setHookState((prev) => {
        if (!prev.state) return prev;
        
        const toolMessage: ChatMessage = {
          role: "tool" as const,
          toolCallId: data["gen_ai.tool.call.id"],
          content: `Error: ${data["error.message"] || "Unknown error"}`,
          ts: event.ts,
        };
        
        return {
          ...prev,
          state: {
            ...prev.state,
            messages: [...(prev.state.messages || []), toolMessage],
          },
        };
      });
    }
  }, [agentId]);

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

  // Send message with optimistic update and rollback
  const sendMessage = useCallback(
    async (content: string) => {
      const agentClient = agentClientRef.current;
      if (!agentClient) throw new Error("No agent selected");

      const message: ChatMessage = {
        role: "user",
        content,
      };

      // Capture previous state for rollback
      let previousMessages: ChatMessage[] | null = null;
      
      // Optimistically add user message
      setHookState((prev) => {
        if (!prev.state) return prev;
        previousMessages = prev.state.messages || [];
        return {
          ...prev,
          state: {
            ...prev.state,
            messages: [...(prev.state.messages || []), message],
          },
        };
      });

      try {
        // Invoke agent - response will come via WebSocket events
        await agentClient.invoke({ messages: [message] });
      } catch (error) {
        // Rollback optimistic update on failure
        if (previousMessages !== null) {
          const rollbackMessages = previousMessages;
          setHookState((prev) => {
            if (!prev.state) return prev;
            return {
              ...prev,
              state: {
                ...prev.state,
                messages: rollbackMessages,
              },
            };
          });
        }
        throw error; // Re-throw so caller can handle
      }
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

  // Reconnect handler - uses the agency WS reconnect
  const reconnect = useCallback(() => {
    if (agencyId) {
      reconnectAgencyWs(agencyId);
    }
  }, [agencyId]);

  return {
    ...hookState,
    sendMessage,
    cancel,
    approve,
    refresh: fetchState,
    refreshEvents: fetchEvents,
    reconnect,
  };
}

// ============================================================================
// useAgencyMetrics - Simple metrics from /metrics endpoint
// ============================================================================

export interface AgencyMetrics {
  agents: {
    total: number;
    byType: Record<string, number>;
  };
  schedules: {
    total: number;
    active: number;
    paused: number;
    disabled: number;
  };
  runs: {
    today: number;
    completed: number;
    failed: number;
    successRate: number;
  };
  timestamp: string;
}

const EMPTY_METRICS: AgencyMetrics = {
  agents: { total: 0, byType: {} },
  schedules: { total: 0, active: 0, paused: 0, disabled: 0 },
  runs: { today: 0, completed: 0, failed: 0, successRate: 100 },
  timestamp: new Date().toISOString(),
};

/**
 * Hook to fetch agency-wide metrics from the /metrics endpoint.
 * Uses React Query for caching and automatic refetch.
 */
export function useAgencyMetrics(agencyId: string | null) {
  const [metrics, setMetrics] = useState<AgencyMetrics>(EMPTY_METRICS);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const fetchMetrics = useCallback(async () => {
    if (!agencyId) {
      setMetrics(EMPTY_METRICS);
      setHasFetched(false);
      return;
    }

    setIsLoading(true);

    try {
      const client = getClient().agency(agencyId);
      const data = await client.getMetrics();
      setMetrics(data);
      setHasFetched(true);
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    } finally {
      setIsLoading(false);
    }
  }, [agencyId]);

  // Fetch on mount and when agencyId changes
  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return {
    metrics,
    isLoading,
    hasFetched,
    refresh: fetchMetrics,
  };
}
