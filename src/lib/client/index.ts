import type {
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
} from "@runtime";

export interface AgencyMeta {
  id: string;
  name: string;
  createdAt: string;
}

// ============================================================================
// Schedule Types
// ============================================================================

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

// ============================================================================
// Filesystem Types
// ============================================================================

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

/** Response from GET /agencies */
export interface ListAgenciesResponse {
  agencies: AgencyMeta[];
}

/** Response from POST /agencies */
export interface CreateAgencyResponse extends AgencyMeta {}

/** Response from GET /agency/:id/blueprints */
export interface ListBlueprintsResponse {
  blueprints: AgentBlueprint[];
}

/** Response from POST /agency/:id/blueprints */
export interface CreateBlueprintResponse {
  ok: boolean;
  name: string;
}

/** Agent summary returned from listing */
export interface AgentSummary {
  id: string;
  agentType: string;
  createdAt: string;
  request?: unknown;
  agencyId?: string;
}

/** Response from GET /agency/:id/agents */
export interface ListAgentsResponse {
  agents: AgentSummary[];
}

/** Response from POST /agency/:id/agents (spawn) */
export interface SpawnAgentResponse extends ThreadMetadata {}

/** Response from POST /invoke */
export interface InvokeResponse {
  runId: string;
  status: string;
}

/** Response from GET /state */
export interface GetStateResponse {
  state: AgentState & {
    subagents?: SubagentLink[];
  };
  run: RunState;
}

/** Response from GET /events */
export interface GetEventsResponse {
  events: AgentEvent[];
}

/** Response from POST /approve or /cancel */
export interface OkResponse {
  ok: boolean;
}

// ============================================================================
// Request Types
// ============================================================================

export interface CreateAgencyRequest {
  name?: string;
}

export interface CreateBlueprintRequest {
  name: string;
  description?: string;
  prompt: string;
  tags: string[];
  model?: string;
  config?: Record<string, unknown>;
  status?: "active" | "draft" | "disabled";
}

export interface SpawnAgentRequest {
  agentType: string;
}

export interface InvokeRequest {
  messages?: ChatMessage[];
  files?: Record<string, string>;
  idempotencyKey?: string;
}

export type ApproveRequest = ApproveBody;

// ============================================================================
// WebSocket Types
// ============================================================================

export type WebSocketEvent = AgentEvent & {
  seq: number;
};

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
  /** The underlying WebSocket */
  ws: WebSocket;
  /** Send a message to the agent */
  send: (message: unknown) => void;
  /** Close the connection */
  close: () => void;
}

// ============================================================================
// Client Options
// ============================================================================

export interface AgentHubClientOptions {
  /** Base URL of the agent hub (e.g., "https://my-agent.workers.dev") */
  baseUrl: string;
  /** Optional secret for authentication (sent as X-SECRET header) */
  secret?: string;
  /** Custom fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch;
}

// ============================================================================
// Error Types
// ============================================================================

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

// ============================================================================
// Agent Client
// ============================================================================

/**
 * Client for interacting with a specific agent instance.
 */
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

  /**
   * Get the current state of the agent including messages, tools, and run status.
   */
  async getState(): Promise<GetStateResponse> {
    return this.request<GetStateResponse>("GET", "/state");
  }

  /**
   * Get all events emitted by this agent.
   */
  async getEvents(): Promise<GetEventsResponse> {
    return this.request<GetEventsResponse>("GET", "/events");
  }

  /**
   * Invoke the agent with optional messages and files.
   * This starts or continues an agent run.
   */
  async invoke(request: InvokeRequest = {}): Promise<InvokeResponse> {
    return this.request<InvokeResponse>("POST", "/invoke", request);
  }

  /**
   * Approve or reject pending tool calls (Human-in-the-Loop).
   */
  async approve(request: ApproveRequest): Promise<OkResponse> {
    return this.request<OkResponse>("POST", "/approve", request);
  }

  /**
   * Cancel the current agent run.
   */
  async cancel(): Promise<OkResponse> {
    return this.request<OkResponse>("POST", "/cancel");
  }

  /**
   * Establish a WebSocket connection for real-time events.
   *
   * @example
   * ```ts
   * const { ws, close } = agentClient.connect({
   *   onEvent: (event) => {
   *     console.log(`[${event.type}]`, event.data);
   *   },
   *   onClose: () => console.log("Connection closed"),
   * });
   *
   * // Later...
   * close();
   * ```
   */
  connect(options: WebSocketOptions = {}): AgentWebSocket {
    const wsUrl = this.path
      .replace(/^http/, "ws")
      .replace(/^wss:\/\/localhost/, "ws://localhost");
    console.log("WebSocket URL:", wsUrl);
    const ws = new WebSocket(wsUrl, options.protocols);

    ws.onopen = () => options.onOpen?.();

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as WebSocketEvent;
        options.onEvent?.(data);
      } catch {
        // Non-JSON message, ignore or handle differently
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

  /** The agent ID */
  get id(): string {
    return this.agentId;
  }
}

// ============================================================================
// Agency Client
// ============================================================================

/**
 * Client for interacting with a specific agency.
 */
export class AgencyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly agencyId: string,
    private readonly headers: HeadersInit,
    private readonly fetchFn: typeof fetch
  ) {}

  private get path(): string {
    return `${this.baseUrl}/agency/${this.agencyId}`;
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

  /**
   * List all blueprints available in this agency.
   * This includes both static defaults and agency-specific overrides.
   */
  async listBlueprints(): Promise<ListBlueprintsResponse> {
    return this.request<ListBlueprintsResponse>("GET", "/blueprints");
  }

  /**
   * Create or update a blueprint in this agency.
   */
  async createBlueprint(
    blueprint: CreateBlueprintRequest
  ): Promise<CreateBlueprintResponse> {
    return this.request<CreateBlueprintResponse>(
      "POST",
      "/blueprints",
      blueprint
    );
  }

  /**
   * List all agents in this agency.
   */
  async listAgents(): Promise<ListAgentsResponse> {
    return this.request<ListAgentsResponse>("GET", "/agents");
  }

  /**
   * Spawn a new agent instance of the given type.
   */
  async spawnAgent(request: SpawnAgentRequest): Promise<SpawnAgentResponse> {
    return this.request<SpawnAgentResponse>("POST", "/agents", request);
  }

  /**
   * Get a client for interacting with a specific agent.
   */
  agent(agentId: string): AgentClient {
    return new AgentClient(
      this.baseUrl,
      this.agencyId,
      agentId,
      this.headers,
      this.fetchFn
    );
  }

  // ==========================================================================
  // Schedule Management
  // ==========================================================================

  /**
   * List all schedules in this agency.
   */
  async listSchedules(): Promise<ListSchedulesResponse> {
    return this.request<ListSchedulesResponse>("GET", "/schedules");
  }

  /**
   * Create a new schedule.
   */
  async createSchedule(
    request: CreateScheduleRequest
  ): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>("POST", "/schedules", request);
  }

  /**
   * Get a specific schedule by ID.
   */
  async getSchedule(scheduleId: string): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>("GET", `/schedules/${scheduleId}`);
  }

  /**
   * Update a schedule.
   */
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

  /**
   * Delete a schedule.
   */
  async deleteSchedule(scheduleId: string): Promise<OkResponse> {
    return this.request<OkResponse>("DELETE", `/schedules/${scheduleId}`);
  }

  /**
   * Pause a schedule.
   */
  async pauseSchedule(scheduleId: string): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>(
      "POST",
      `/schedules/${scheduleId}/pause`
    );
  }

  /**
   * Resume a paused schedule.
   */
  async resumeSchedule(scheduleId: string): Promise<ScheduleResponse> {
    return this.request<ScheduleResponse>(
      "POST",
      `/schedules/${scheduleId}/resume`
    );
  }

  /**
   * Manually trigger a schedule run.
   */
  async triggerSchedule(scheduleId: string): Promise<TriggerScheduleResponse> {
    return this.request<TriggerScheduleResponse>(
      "POST",
      `/schedules/${scheduleId}/trigger`
    );
  }

  /**
   * Get the run history for a schedule.
   */
  async getScheduleRuns(scheduleId: string): Promise<ListScheduleRunsResponse> {
    return this.request<ListScheduleRunsResponse>(
      "GET",
      `/schedules/${scheduleId}/runs`
    );
  }

  // ==========================================================================
  // Filesystem Operations
  // ==========================================================================

  /**
   * List contents of a directory.
   * @param path - Path relative to agency root (e.g., '/shared', '/agents/abc123')
   */
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

    // Check content-type to determine if it's a file or directory
    const contentType = res.headers.get("content-type") || "";
    const fsPathHeader = res.headers.get("x-fs-path");

    // If it has x-fs-path header or is plain text (not JSON), it's a file
    if (
      fsPathHeader ||
      (contentType.includes("text/plain") && !contentType.includes("json"))
    ) {
      throw new AgentHubError("Path is a file, not a directory", 400, "");
    }

    // Try to parse as JSON
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      // If JSON parse fails, it's probably a file
      throw new AgentHubError("Path is a file, not a directory", 400, "");
    }
  }

  /**
   * Read a file's contents.
   * @param path - Path to the file
   */
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

    // Check content-type and headers
    const contentType = res.headers.get("content-type") || "";
    const fsPathHeader = res.headers.get("x-fs-path");

    // Read the response body
    const content = await res.text();

    // If it has x-fs-path header, it's definitely a file
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

    // If content-type is text/plain (not json), treat as file
    if (contentType.includes("text/plain") && !contentType.includes("json")) {
      return {
        content,
        path: "/" + fsPath,
        size: content.length,
        modified: "",
      };
    }

    // Try to detect if content is JSON (directory listing) vs file content
    const trimmed = content.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      // Looks like JSON - probably a directory listing
      try {
        JSON.parse(content);
        // Successfully parsed as JSON, it's a directory
        throw new AgentHubError("Path is a directory, not a file", 400, "");
      } catch (e) {
        if (e instanceof AgentHubError) throw e;
        // JSON parse failed, treat as file content
      }
    }

    // Default: treat as file
    return {
      content,
      path: "/" + fsPath,
      size: content.length,
      modified: "",
    };
  }

  /**
   * Write content to a file.
   * @param path - Path to the file
   * @param content - File content
   */
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

  /**
   * Delete a file.
   * @param path - Path to the file
   */
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

  /** The agency ID */
  get id(): string {
    return this.agencyId;
  }
}

// ============================================================================
// Main Client
// ============================================================================

/**
 * TypeScript client for the Agent Hub control plane.
 *
 * @example
 * ```ts
 * const client = new AgentHubClient({
 *   baseUrl: "https://my-agent.workers.dev",
 *   secret: "optional-auth-secret"
 * });
 *
 * // Create an agency and spawn an agent
 * const agency = await client.createAgency({ name: "My Agency" });
 * const agencyClient = client.agency(agency.id);
 * const agent = await agencyClient.spawnAgent({ agentType: "assistant" });
 *
 * // Interact with the agent
 * const agentClient = agencyClient.agent(agent.id);
 * await agentClient.invoke({
 *   messages: [{ role: "user", content: "Hello!" }]
 * });
 *
 * // Poll for state or use WebSocket
 * const { state, run } = await agentClient.getState();
 * console.log("Status:", run.status);
 * console.log("Messages:", state.messages);
 * ```
 */
export class AgentHubClient {
  private readonly baseUrl: string;
  private readonly headers: HeadersInit;
  private readonly fetchFn: typeof fetch;

  constructor(options: AgentHubClientOptions) {
    // Normalize base URL (remove trailing slash)
    this.baseUrl = options.baseUrl.replace(/\/$/, "");

    // Build headers
    this.headers = {};
    if (options.secret) {
      (this.headers as Record<string, string>)["X-SECRET"] = options.secret;
    }

    // Use provided fetch or global
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

  /**
   * List all agencies in the system.
   */
  async listAgencies(): Promise<ListAgenciesResponse> {
    return this.request<ListAgenciesResponse>("GET", "/agencies");
  }

  /**
   * Create a new agency.
   */
  async createAgency(
    request: CreateAgencyRequest = {}
  ): Promise<CreateAgencyResponse> {
    return this.request<CreateAgencyResponse>("POST", "/agencies", request);
  }

  /**
   * Get a client for interacting with a specific agency.
   */
  agency(agencyId: string): AgencyClient {
    return new AgencyClient(this.baseUrl, agencyId, this.headers, this.fetchFn);
  }
}

// ============================================================================
// Re-export relevant types for convenience
// ============================================================================

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
