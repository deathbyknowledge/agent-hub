import type {
  AgentBlueprint,
  AgentState,
  ApproveBody,
  ChatMessage,
  InvokeBody,
  RunState,
  RunStatus,
  SubagentLink,
  ThreadMetadata,
  ToolCall,
  ToolMeta,
  AgentEvent,
  AgentEventType,
} from "../runtime";

export interface AgencyMeta {
  id: string;
  name: string;
  createdAt: string;
}

export type AgentScheduleType = "once" | "cron" | "interval";
export type OverlapPolicy = "skip" | "queue" | "allow";
export type ScheduleStatus = "active" | "paused" | "disabled";
export type ScheduleRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface AgentSchedule {
  id: string;
  name: string;
  agentType: string;
  input?: Record<string, unknown>;

  // Timing
  type: AgentScheduleType;
  runAt?: string;
  cron?: string;
  intervalMs?: number;

  // Behavior
  status: ScheduleStatus;
  timezone?: string;
  maxRetries?: number;
  timeoutMs?: number;
  overlapPolicy: OverlapPolicy;

  // Metadata
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  agentId?: string;
  status: ScheduleRunStatus;
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  result?: string;
  retryCount: number;
}

export interface CreateScheduleRequest {
  name: string;
  agentType: string;
  input?: Record<string, unknown>;
  type: AgentScheduleType;
  runAt?: string;
  cron?: string;
  intervalMs?: number;
  timezone?: string;
  maxRetries?: number;
  timeoutMs?: number;
  overlapPolicy?: OverlapPolicy;
}

export interface UpdateScheduleRequest {
  name?: string;
  agentType?: string;
  input?: Record<string, unknown>;
  type?: AgentScheduleType;
  runAt?: string;
  cron?: string;
  intervalMs?: number;
  timezone?: string;
  maxRetries?: number;
  timeoutMs?: number;
  overlapPolicy?: OverlapPolicy;
}

/** Response from GET /agency/:id/schedules */
export interface ListSchedulesResponse {
  schedules: AgentSchedule[];
}

/** Response from schedule operations */
export interface ScheduleResponse {
  schedule: AgentSchedule;
}

/** Response from GET /agency/:id/schedules/:id/runs */
export interface ListScheduleRunsResponse {
  runs: ScheduleRun[];
}

/** Response from POST /agency/:id/schedules/:id/trigger */
export interface TriggerScheduleResponse {
  run: ScheduleRun;
}

export interface FSEntry {
  type: "file" | "dir";
  path: string;
  size?: number;
  modified?: string;
}

export interface ListDirectoryResponse {
  path: string;
  entries: FSEntry[];
}

export interface ReadFileResponse {
  content: string;
  path: string;
  size: number;
  modified: string;
}

export interface WriteFileResponse {
  ok: boolean;
  path: string;
  size: number;
}

export interface DeleteFileResponse {
  ok: boolean;
  path: string;
}

export interface GetVarsResponse {
  vars: Record<string, unknown>;
}

/** Response from GET /agency/:id/metrics */
export interface GetMetricsResponse {
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

/** Response from GET /agency/:id/vars/:key */
export interface GetVarResponse {
  key: string;
  value: unknown;
}

/** Response from PUT /agency/:id/vars or vars/:key */
export interface SetVarResponse {
  ok: boolean;
  key?: string;
  value?: unknown;
  vars?: Record<string, unknown>;
}

export interface ListAgenciesResponse {
  agencies: AgencyMeta[];
}

export interface VarHint {
  name: string;
  required?: boolean;
  description?: string;
}

export interface PluginInfo {
  name: string;
  tags: string[];
  varHints?: VarHint[];
}

export interface ToolInfo {
  name: string;
  description?: string;
  tags: string[];
  varHints?: VarHint[];
}

export interface GetPluginsResponse {
  plugins: PluginInfo[];
  tools: ToolInfo[];
}

// ============================================================
// MCP Server Types
// ============================================================

// SDK states: "authenticating" | "connecting" | "connected" | "discovering" | "ready" | "failed"
export type McpServerStatus = "authenticating" | "connecting" | "connected" | "discovering" | "ready" | "failed";

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  status: McpServerStatus;
  authUrl?: string;
  error?: string;
}

export interface AddMcpServerRequest {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface McpToolInfo {
  serverId: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ListMcpToolsResponse {
  tools: McpToolInfo[];
}

export interface ListMcpServersResponse {
  servers: McpServerConfig[];
}

export interface McpServerResponse {
  server: McpServerConfig;
}

export interface CreateAgencyResponse extends AgencyMeta {}

export interface ListBlueprintsResponse {
  blueprints: AgentBlueprint[];
}

export interface CreateBlueprintResponse {
  ok: boolean;
  name: string;
}

export interface AgentSummary {
  id: string;
  agentType: string;
  createdAt: string;
  request?: unknown;
  agencyId?: string;
  relatedAgentId?: string;
}

export interface ListAgentsResponse {
  agents: AgentSummary[];
}

export interface AgentTreeResponse {
  agent: AgentSummary;
  ancestors: AgentSummary[];
  descendants: AgentSummary[];
}

export interface AgentNode extends AgentSummary {
  children: AgentNode[];
}

export interface AgentForestResponse {
  roots: AgentNode[];
}

export interface SpawnAgentResponse extends ThreadMetadata {}

export interface InvokeResponse {
  status: string;
}

export interface GetStateResponse {
  state: AgentState & {
    subagents?: SubagentLink[];
  };
  run: RunState;
}

export interface GetEventsResponse {
  events: AgentEvent[];
}

/** Projection state derived from events (event-sourced) */
export interface ProjectionState {
  messages: unknown[];
  status: RunStatus;
  step: number;
  pendingToolCalls: ToolCall[];
  vars: Record<string, unknown>;
  totalInputTokens: number;
  totalOutputTokens: number;
  inferenceCount: number;
  lastError?: { type: string; message?: string };
}

export interface GetProjectionResponse {
  projection: ProjectionState;
  meta: {
    eventCount: number;
    atSeq: number | null;
  };
}

export interface GetProjectionOptions {
  /** Sequence number to project up to (for time-travel) */
  at?: number;
  /** If true, convert messages to legacy format */
  legacy?: boolean;
}

export interface ExportEventsResponse {
  meta: {
    threadId: string;
    agencyId: string;
    agentType: string;
    createdAt: string;
    exportedAt: string;
    eventCount: number;
  };
  events: AgentEvent[];
  snapshot?: {
    lastEventSeq: number;
    state: ProjectionState;
    createdAt: string;
  };
}

export interface ExportEventsOptions {
  /** If true, include latest snapshot in export */
  includeSnapshot?: boolean;
}

export interface ForkAgentResponse {
  /** The new forked agent */
  agent: AgentSummary;
  /** Number of events copied to the fork */
  eventsCopied: number;
}

export interface ForkAgentOptions {
  /** Sequence number to fork from (defaults to latest) */
  at?: number;
  /** Custom ID for the forked agent */
  id?: string;
}

export interface OkResponse {
  ok: boolean;
}

export interface CreateAgencyRequest {
  name?: string;
}

export interface CreateBlueprintRequest {
  name: string;
  description?: string;
  prompt: string;
  capabilities: string[];
  model?: string;
  config?: Record<string, unknown>;
  status?: "active" | "draft" | "disabled";
}

export interface SpawnAgentRequest {
  agentType: string;
  relatedAgentId?: string;
  input?: Record<string, unknown>;
  /** Optional custom ID for the agent. If an agent with this ID exists, it will be resumed instead of created. */
  id?: string;
}

export interface InvokeRequest {
  messages?: ChatMessage[];
  files?: Record<string, string>;
  idempotencyKey?: string;
}

export type ApproveRequest = ApproveBody;

export type WebSocketEvent = AgentEvent & {
  seq: number;
};

/** Event relayed from agents through the Agency */
export type AgencyWebSocketEvent = AgentEvent & {
  seq: number;
  agentId: string;
  agentType: string;
};

/** Subscription message sent to Agency WebSocket */
export type AgencySubscriptionMessage = 
  | { type: "subscribe"; agentIds?: string[] }
  | { type: "unsubscribe" };

export interface WebSocketOptions {
  /** Called when an event is received */
  onEvent?: (event: WebSocketEvent) => void;
  /** Called when the connection is opened */
  onOpen?: () => void;
  /** Called when the connection is closed */
  onClose?: (event: CloseEvent) => void;
  /** Called on error */
  onError?: (error: Event) => void;
  /** Custom protocols */
  protocols?: string | string[];
}

export interface AgentWebSocket {
  ws: WebSocket;
  send: (message: unknown) => void;
  close: () => void;
}

export interface AgencyWebSocketOptions {
  /** Called when an agent event is received */
  onEvent?: (event: AgencyWebSocketEvent) => void;
  /** Called when the connection is opened */
  onOpen?: () => void;
  /** Called when the connection is closed */
  onClose?: (event: CloseEvent) => void;
  /** Called on error */
  onError?: (error: Event) => void;
  /** Custom protocols */
  protocols?: string | string[];
}

export interface AgencyWebSocket {
  ws: WebSocket;
  send: (message: unknown) => void;
  close: () => void;
  /** Subscribe to events from specific agents. If agentIds is omitted, receives all events. */
  subscribe: (agentIds?: string[]) => void;
  /** Unsubscribe from filtering - receive all events */
  unsubscribe: () => void;
}

export interface AgentHubClientOptions {
  baseUrl: string;
  secret?: string;
  fetch?: typeof fetch;
}

/** Error thrown when an API request fails. */
export class AgentHubError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "AgentHubError";
  }
}

/** Client for interacting with a single agent instance. */
export class AgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly agencyId: string,
    private readonly agentId: string,
    private readonly headers: HeadersInit,
    private readonly fetchFn: typeof fetch
  ) {}

  private get path(): string {
    return `${this.baseUrl}/agency/${this.agencyId}/agent/${this.agentId}`;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.path}${endpoint}`;
    const res = await this.fetchFn(url, {
      method,
      headers: {
        ...this.headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AgentHubError(
        `Request failed: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }

    return res.json();
  }

  async getState(): Promise<GetStateResponse> {
    return this.request<GetStateResponse>("GET", "/state");
  }

  async getEvents(): Promise<GetEventsResponse> {
    return this.request<GetEventsResponse>("GET", "/events");
  }

  /**
   * Get projected state from events (event-sourced).
   * Supports time-travel via the `at` option.
   */
  async getProjection(options: GetProjectionOptions = {}): Promise<GetProjectionResponse> {
    const params = new URLSearchParams();
    if (options.at !== undefined) params.set("at", String(options.at));
    if (options.legacy) params.set("legacy", "true");
    const query = params.toString();
    return this.request<GetProjectionResponse>("GET", `/projection${query ? `?${query}` : ""}`);
  }

  /**
   * Export all events for debugging or migration.
   */
  async exportEvents(options: ExportEventsOptions = {}): Promise<ExportEventsResponse> {
    const params = new URLSearchParams();
    if (options.includeSnapshot) params.set("includeSnapshot", "true");
    const query = params.toString();
    return this.request<ExportEventsResponse>("GET", `/export${query ? `?${query}` : ""}`);
  }

  /**
   * Fork this agent at a specific point in its history.
   * Creates a new agent with events up to the specified sequence.
   */
  async fork(options: ForkAgentOptions = {}): Promise<ForkAgentResponse> {
    return this.request<ForkAgentResponse>("POST", "/fork", options);
  }

  async invoke(request: InvokeRequest = {}): Promise<InvokeResponse> {
    return this.request<InvokeResponse>("POST", "/invoke", request);
  }

  async action<T = unknown>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>("POST", "/action", { type, ...payload });
  }

  connect(options: WebSocketOptions = {}): AgentWebSocket {
    const secret = (this.headers as Record<string, string>)["X-SECRET"];
    const secretParam = secret ? `?key=${encodeURIComponent(secret)}` : "";
    const wsUrl = this.path
      .replace(/^http/, "ws")
      .replace(/^wss:\/\/localhost/, "ws://localhost") + secretParam;
    const ws = new WebSocket(wsUrl, options.protocols);

    ws.onopen = () => options.onOpen?.();

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as WebSocketEvent;
        options.onEvent?.(data);
      } catch {
        // Non-JSON message
      }
    };

    ws.onclose = (event) => options.onClose?.(event);
    ws.onerror = (event) => options.onError?.(event);

    return {
      ws,
      send: (message: unknown) => ws.send(JSON.stringify(message)),
      close: () => ws.close(),
    };
  }

  get id(): string {
    return this.agentId;
  }
}

/** Client for managing an agency and its agents, blueprints, schedules, and files. */
export class AgencyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly agencyId: string,
    private readonly headers: HeadersInit,
    private readonly fetchFn: typeof fetch
  ) {}

  private get path(): string {
    return `${this.baseUrl}/agency/${encodeURIComponent(this.agencyId)}`;
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.path}${endpoint}`;
    const res = await this.fetchFn(url, {
      method,
      headers: {
        ...this.headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AgentHubError(
        `Request failed: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }

    return res.json();
  }

  async listBlueprints(): Promise<ListBlueprintsResponse> {
    return this.request<ListBlueprintsResponse>("GET", "/blueprints");
  }

  async createBlueprint(
    blueprint: CreateBlueprintRequest
  ): Promise<CreateBlueprintResponse> {
    return this.request<CreateBlueprintResponse>(
      "POST",
      "/blueprints",
      blueprint
    );
  }

  async deleteBlueprint(name: string): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("DELETE", `/blueprints/${name}`);
  }

  async listAgents(): Promise<ListAgentsResponse> {
    return this.request<ListAgentsResponse>("GET", "/agents");
  }

  async spawnAgent(request: SpawnAgentRequest): Promise<SpawnAgentResponse> {
    return this.request<SpawnAgentResponse>("POST", "/agents", request);
  }

  async deleteAgent(agentId: string): Promise<OkResponse> {
    return this.request<OkResponse>("DELETE", `/agents/${agentId}`);
  }

  async getAgentTree(agentId: string): Promise<AgentTreeResponse> {
    return this.request<AgentTreeResponse>("GET", `/agents/${agentId}/tree`);
  }

  async getAgentForest(): Promise<AgentForestResponse> {
    return this.request<AgentForestResponse>("GET", "/agents/tree");
  }

  agent(agentId: string): AgentClient {
    return new AgentClient(
      this.baseUrl,
      this.agencyId,
      agentId,
      this.headers,
      this.fetchFn
    );
  }

  async listSchedules(): Promise<ListSchedulesResponse> {
    return this.request<ListSchedulesResponse>("GET", "/schedules");
  }

  async createSchedule(
    request: CreateScheduleRequest
  ): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>("POST", "/schedules", request);
  }

  async getSchedule(scheduleId: string): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>("GET", `/schedules/${scheduleId}`);
  }

  async updateSchedule(
    scheduleId: string,
    request: UpdateScheduleRequest
  ): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>(
      "PATCH",
      `/schedules/${scheduleId}`,
      request
    );
  }

  async deleteSchedule(scheduleId: string): Promise<OkResponse> {
    return this.request<OkResponse>("DELETE", `/schedules/${scheduleId}`);
  }

  async pauseSchedule(scheduleId: string): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>(
      "POST",
      `/schedules/${scheduleId}/pause`
    );
  }

  async resumeSchedule(scheduleId: string): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>(
      "POST",
      `/schedules/${scheduleId}/resume`
    );
  }

  async triggerSchedule(scheduleId: string): Promise<TriggerScheduleResponse> {
    return this.request<TriggerScheduleResponse>(
      "POST",
      `/schedules/${scheduleId}/trigger`
    );
  }

  async getScheduleRuns(scheduleId: string): Promise<ListScheduleRunsResponse> {
    return this.request<ListScheduleRunsResponse>(
      "GET",
      `/schedules/${scheduleId}/runs`
    );
  }

  async listDirectory(path: string = "/"): Promise<ListDirectoryResponse> {
    const fsPath = path.startsWith("/") ? path.slice(1) : path;
    const url = `${this.path}/fs/${fsPath}`;
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AgentHubError(
        `Failed to list directory: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }

    const contentType = res.headers.get("content-type") || "";
    const fsPathHeader = res.headers.get("x-fs-path");

    if (
      fsPathHeader ||
      (contentType.includes("text/plain") && !contentType.includes("json"))
    ) {
      throw new AgentHubError("Path is a file, not a directory", 400, "");
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new AgentHubError("Path is a file, not a directory", 400, "");
    }
  }

  async readFile(path: string): Promise<ReadFileResponse> {
    const fsPath = path.startsWith("/") ? path.slice(1) : path;
    const url = `${this.path}/fs/${fsPath}`;
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AgentHubError(
        `Failed to read file: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }

    const contentType = res.headers.get("content-type") || "";
    const fsPathHeader = res.headers.get("x-fs-path");
    const content = await res.text();

    if (fsPathHeader) {
      return {
        content,
        path: fsPathHeader,
        size: parseInt(
          res.headers.get("x-fs-size") || String(content.length),
          10
        ),
        modified: res.headers.get("x-fs-modified") || "",
      };
    }

    if (contentType.includes("text/plain") && !contentType.includes("json")) {
      return {
        content,
        path: "/" + fsPath,
        size: content.length,
        modified: "",
      };
    }

    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(content);
        throw new AgentHubError("Path is a directory, not a file", 400, "");
      } catch (e) {
        if (e instanceof AgentHubError) throw e;
      }
    }

    return {
      content,
      path: "/" + fsPath,
      size: content.length,
      modified: "",
    };
  }

  async writeFile(path: string, content: string): Promise<WriteFileResponse> {
    const fsPath = path.startsWith("/") ? path.slice(1) : path;
    const url = `${this.path}/fs/${fsPath}`;
    const res = await this.fetchFn(url, {
      method: "PUT",
      headers: {
        ...this.headers,
        "Content-Type": "text/plain",
      },
      body: content,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AgentHubError(
        `Failed to write file: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }

    return res.json();
  }

  async deleteFile(path: string): Promise<DeleteFileResponse> {
    const fsPath = path.startsWith("/") ? path.slice(1) : path;
    const url = `${this.path}/fs/${fsPath}`;
    const res = await this.fetchFn(url, {
      method: "DELETE",
      headers: this.headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AgentHubError(
        `Failed to delete file: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }

    return res.json();
  }

  async getVars(): Promise<GetVarsResponse> {
    return this.request<GetVarsResponse>("GET", "/vars");
  }

  async setVars(vars: Record<string, unknown>): Promise<SetVarResponse> {
    return this.request<SetVarResponse>("PUT", "/vars", vars);
  }

  async getVar(key: string): Promise<GetVarResponse> {
    return this.request<GetVarResponse>("GET", `/vars/${encodeURIComponent(key)}`);
  }

  async setVar(key: string, value: unknown): Promise<SetVarResponse> {
    return this.request<SetVarResponse>("PUT", `/vars/${encodeURIComponent(key)}`, { value });
  }

  async deleteVar(key: string): Promise<OkResponse> {
    return this.request<OkResponse>("DELETE", `/vars/${encodeURIComponent(key)}`);
  }

  // MCP Server methods

  async listMcpServers(): Promise<ListMcpServersResponse> {
    return this.request<ListMcpServersResponse>("GET", "/mcp");
  }

  async addMcpServer(request: AddMcpServerRequest): Promise<McpServerResponse> {
    return this.request<McpServerResponse>("POST", "/mcp", request);
  }

  async removeMcpServer(serverId: string): Promise<OkResponse> {
    return this.request<OkResponse>("DELETE", `/mcp/${serverId}`);
  }

  async retryMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>("POST", `/mcp/${serverId}/retry`);
  }

  async listMcpTools(): Promise<ListMcpToolsResponse> {
    return this.request<ListMcpToolsResponse>("GET", "/mcp/tools");
  }

  async deleteAgency(): Promise<OkResponse> {
    return this.request<OkResponse>("DELETE", "/destroy");
  }

  /**
   * Get aggregated metrics for this agency.
   * Returns counts and stats for agents, schedules, and recent runs.
   */
  async getMetrics(): Promise<GetMetricsResponse> {
    return this.request<GetMetricsResponse>("GET", "/metrics");
  }

  /**
   * Connect to the agency-level WebSocket for real-time agent events.
   * This single connection receives events from all agents in the agency.
   * 
   * @example
   * ```ts
   * const connection = agency.connect({
   *   onEvent: (event) => {
   *     console.log(`Event from ${event.agentId}:`, event.type);
   *   },
   * });
   * 
   * // Subscribe to specific agents only
   * connection.subscribe(["agent-1", "agent-2"]);
   * 
   * // Unsubscribe to receive all events
   * connection.unsubscribe();
   * ```
   */
  connect(options: AgencyWebSocketOptions = {}): AgencyWebSocket {
    const secret = (this.headers as Record<string, string>)["X-SECRET"];
    const secretParam = secret ? `?key=${encodeURIComponent(secret)}` : "";
    const wsUrl = `${this.path}/ws`
      .replace(/^http/, "ws")
      .replace(/^wss:\/\/localhost/, "ws://localhost") + secretParam;
    const ws = new WebSocket(wsUrl, options.protocols);

    ws.onopen = () => options.onOpen?.();

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as AgencyWebSocketEvent;
        options.onEvent?.(data);
      } catch {
        // Non-JSON message
      }
    };

    ws.onclose = (event) => options.onClose?.(event);
    ws.onerror = (event) => options.onError?.(event);

    return {
      ws,
      send: (message: unknown) => ws.send(JSON.stringify(message)),
      close: () => ws.close(),
      subscribe: (agentIds?: string[]) => {
        const msg: AgencySubscriptionMessage = { type: "subscribe", agentIds };
        ws.send(JSON.stringify(msg));
      },
      unsubscribe: () => {
        const msg: AgencySubscriptionMessage = { type: "unsubscribe" };
        ws.send(JSON.stringify(msg));
      },
    };
  }

  get id(): string {
    return this.agencyId;
  }
}

/**
 * Top-level client for interacting with the AgentHub API.
 *
 * @example
 * ```ts
 * const client = new AgentHubClient({ baseUrl: "https://hub.example.com" });
 * const { agencies } = await client.listAgencies();
 * const agency = client.agency(agencies[0].id);
 * const agent = agency.agent("my-agent-id");
 * await agent.invoke({ messages: [{ role: "user", content: "Hello" }] });
 * ```
 */
export class AgentHubClient {
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;
  private readonly fetchFn: typeof fetch;

  constructor(options: AgentHubClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.headers = {};
    if (options.secret) {
      (this.headers as Record<string, string>)["X-SECRET"] = options.secret;
    }

    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await this.fetchFn(url, {
      method,
      headers: {
        ...this.headers,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AgentHubError(
        `Request failed: ${res.status} ${res.statusText}`,
        res.status,
        text
      );
    }

    return res.json();
  }

  async listAgencies(): Promise<ListAgenciesResponse> {
    return this.request<ListAgenciesResponse>("GET", "/agencies");
  }

  async getPlugins(): Promise<GetPluginsResponse> {
    return this.request<GetPluginsResponse>("GET", "/plugins");
  }

  async createAgency(
    request: CreateAgencyRequest = {}
  ): Promise<CreateAgencyResponse> {
    return this.request<CreateAgencyResponse>("POST", "/agencies", request);
  }

  async deleteAgency(agencyId: string): Promise<OkResponse> {
    return this.agency(agencyId).deleteAgency();
  }

  agency(agencyId: string): AgencyClient {
    return new AgencyClient(this.baseUrl, agencyId, this.headers, this.fetchFn);
  }
}

export type {
  AgentBlueprint,
  AgentState,
  ApproveBody,
  ChatMessage,
  InvokeBody,
  RunState,
  SubagentLink,
  ThreadMetadata,
  ToolCall,
  ToolMeta,
  AgentEvent,
  AgentEventType,
};
