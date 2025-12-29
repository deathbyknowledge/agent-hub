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
} from "agent-hub/client";

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
};

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

  return {
    agents,
    blueprints,
    schedules,
    vars,
    memoryDisks,
    loading,
    error: error as Error | null,
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
