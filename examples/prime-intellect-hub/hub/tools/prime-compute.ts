import { tool, z } from "agents-hub";

const PI_API_BASE = "https://api.primeintellect.ai/api/v1";

// Type definitions for PI API responses
interface GpuAvailabilityItem {
  provider: string;
  gpuType: string;
  gpuCount: number;
  socket: string;
  region: string;
  dataCenter: string;
  stockStatus: string;
  cloudId: string;
  prices: { onDemand?: number; communityPrice?: number };
}

interface GpuAvailabilityResponse {
  items: GpuAvailabilityItem[];
  totalCount: number;
}

interface PodResponse {
  id: string;
  name: string;
  status: string;
  installationStatus: string;
  installationProgress: number;
  gpuCount: number;
  gpuName: string;
  priceHr: number;
  createdAt: string;
  sshConnection: string;
  ip: string;
  resources: Record<string, unknown>;
  environmentType: string;
}

interface DiskResponse {
  id: string;
  name: string;
  size: number;
  status: string;
  region: string;
}

// Helper to make authenticated requests
async function piRequest<T>(
  env: { PRIME_API_KEY?: string },
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = env.PRIME_API_KEY;
  if (!apiKey) {
    throw new Error("PRIME_API_KEY is required. Set it in agency variables.");
  }

  const res = await fetch(`${PI_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prime Intellect API error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// GPU summary - lists all available GPU types with pricing
export const get_gpu_summary = tool({
  name: "get_gpu_summary",
  description: `Get a summary of all available GPU types with pricing information.
Use this FIRST to discover what GPU types are available before querying specific availability.
Returns GPU types grouped by name with min/max pricing across providers.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute, sandbox, evals, and inference access" },
    { name: "PCR_BRIDGE_URL", required: false, description: "Base URL of your PCR room (e.g., https://pcr.example.com/room/home). Required for pod_exec tools. Add your PCR as an MCP server to the Agency first." },
  ],
  inputSchema: z.object({}),
  execute: async (_, ctx) => {
    const result = await piRequest<Record<string, unknown>>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/availability/gpu-summary"
    );

    return JSON.stringify(result, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// GPU availability query
export const get_gpu_availability = tool({
  name: "get_gpu_availability",
  description: `Check available GPU configurations and pricing on Prime Intellect.
Returns a list of available GPU options with pricing, regions, and specifications.
Use get_gpu_summary first to discover valid GPU types, then filter here.
Valid gpu_type values include: H100_80GB, H200_96GB, A100_80GB, A100_40GB, L40S_48GB, RTX4090_24GB, B200_180GB, etc.

IMPORTANT: When calling create_pod, you MUST use the exact values from this response:
- provider: The cloud provider (e.g., 'runpod', 'fluidstack') - REQUIRED for create_pod
- cloud_id: The GPU identifier for that provider
- gpu_type, gpu_count, socket, datacenter: Use these exact values`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({
    regions: z
      .array(z.string())
      .optional()
      .describe("Filter by regions (e.g., 'united_states', 'europe_west', 'canada')"),
    gpu_type: z
      .string()
      .optional()
      .describe("GPU model (e.g., 'H100_80GB', 'A100_80GB', 'H200_96GB', 'L40S_48GB')"),
    gpu_count: z.number().optional().describe("Number of GPUs needed"),
    socket: z
      .string()
      .optional()
      .describe("Socket type: PCIe, SXM4, SXM5"),
    security: z
      .enum(["secure_cloud", "community_cloud"])
      .optional()
      .describe("Security level"),
    page: z.number().optional().describe("Page number (default: 1)"),
    page_size: z.number().optional().describe("Results per page (default: 20)"),
  }),
  execute: async (params, ctx) => {
    const query = new URLSearchParams();
    
    if (params.regions) {
      params.regions.forEach((r) => query.append("regions", r));
    }
    if (params.gpu_type) query.set("gpu_type", params.gpu_type);
    if (params.gpu_count) query.set("gpu_count", String(params.gpu_count));
    if (params.socket) query.set("socket", params.socket);
    if (params.security) query.set("security", params.security);
    // Always set page/page_size with defaults to avoid API errors
    query.set("page", String(params.page ?? 1));
    query.set("page_size", String(params.page_size ?? 20));

    const result = await piRequest<GpuAvailabilityResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/availability/gpus?${query.toString()}`
    );

    // Format response for readability
    // cloud_id is the provider-specific instance ID needed for create_pod
    const items = result.items || [];
    const formatted = items.map((item) => ({
      provider: item.provider,
      gpu_type: item.gpuType,
      gpu_count: item.gpuCount,
      socket: item.socket,
      region: item.region,
      datacenter: item.dataCenter,
      price_hr: `$${item.prices?.onDemand ?? "N/A"}/hr`,
      stock: item.stockStatus,
      // cloud_id is the unique instance identifier - use this exact value in create_pod
      cloud_id: item.cloudId,
    }));

    return JSON.stringify({
      total: result.totalCount,
      page: params.page ?? 1,
      results: formatted,
      usage_hint: "IMPORTANT: When calling create_pod, use the 'provider' value (e.g., 'runpod') along with cloud_id, gpu_type, gpu_count, socket, and datacenter",
    }, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// Multinode summary - overview of available multinode configurations
export const get_multinode_summary = tool({
  name: "get_multinode_summary",
  description: `Get a summary of available multinode GPU cluster configurations.
Use this to see what multinode options are available before querying specific availability.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({}),
  execute: async (_, ctx) => {
    const result = await piRequest<Record<string, unknown>>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/availability/multinode-summary"
    );

    return JSON.stringify(result, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// Multinode availability for large-scale training
export const get_multinode_availability = tool({
  name: "get_multinode_availability",
  description: `Check multinode GPU cluster availability for distributed training.
Use this for large-scale training requiring multiple interconnected nodes.
Use get_multinode_summary first to see available configurations.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({
    gpu_type: z
      .string()
      .optional()
      .describe("GPU model (e.g., 'H100_80GB', 'H200_96GB')"),
    min_nodes: z.number().optional().describe("Minimum number of nodes"),
    page: z.number().optional().describe("Page number (default: 1)"),
    page_size: z.number().optional().describe("Results per page (default: 20)"),
  }),
  execute: async (params, ctx) => {
    const query = new URLSearchParams();
    if (params.gpu_type) query.set("gpu_type", params.gpu_type);
    if (params.min_nodes) query.set("min_nodes", String(params.min_nodes));
    query.set("page", String(params.page ?? 1));
    query.set("page_size", String(params.page_size ?? 20));

    const result = await piRequest<unknown>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/availability/multinode?${query.toString()}`
    );

    return JSON.stringify(result, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// Create a GPU pod
export const create_pod = tool({
  name: "create_pod",
  description: `Provision a GPU pod on Prime Intellect.
IMPORTANT: Always call get_gpu_availability first and confirm costs with user before creating.

Use EXACT values from get_gpu_availability response:
- provider: Cloud provider (e.g., 'runpod', 'fluidstack') - THIS IS REQUIRED
- cloud_id: GPU identifier from availability response
- gpu_type: GPU model (e.g., 'H100_80GB', 'A40_48GB')
- gpu_count: Number from availability response
- socket: Socket type from availability (PCIe, SXM4, SXM5)
- data_center_id: Datacenter from availability response

Returns pod details including ID, status, and connection info.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({
    name: z.string().describe("Name for the pod (alphanumeric, hyphens allowed)"),
    provider: z
      .string()
      .describe("Cloud provider from availability check (e.g., 'runpod', 'fluidstack', 'lambdalabs')"),
    gpu_type: z
      .string()
      .describe("GPU model from availability check (e.g., 'H100_80GB', 'A40_48GB')"),
    gpu_count: z.number().describe("Number of GPUs (1-8 typically)"),
    cloud_id: z
      .string()
      .describe("Cloud ID from availability check - required to specify exact GPU config"),
    socket: z
      .string()
      .describe("Socket type from availability check: PCIe, SXM4, SXM5, SXM6"),
    image: z
      .string()
      .optional()
      .describe("Container image (default: ubuntu_22_cuda_12). Options: ubuntu_22_cuda_12, cuda_12_4_pytorch_2_5, cuda_12_6_pytorch_2_7, prime_rl, axolotl"),
    disk_size: z
      .number()
      .optional()
      .describe("Disk size in GB (default: 100)"),
    data_center_id: z
      .string()
      .optional()
      .describe("Datacenter ID from availability check (e.g., 'EU-SE-1', 'US-IL-1')"),
    region: z.string().optional().describe("Preferred region"),
    env_vars: z
      .record(z.string())
      .optional()
      .describe("Environment variables to set"),
    auto_restart: z.boolean().optional().describe("Auto-restart on failure (default: false)"),
    connect_pcr: z
      .boolean()
      .optional()
      .describe("Auto-setup Personal Compute Relay for remote execution (default: true)"),
  }),
  execute: async (params, ctx) => {
    // Validate required fields
    if (!params.socket) {
      throw new Error("socket is required. Get it from get_gpu_availability response (e.g., 'PCIe', 'SXM4', 'SXM5')");
    }

    const vars = ctx.agent.vars as {
      PRIME_API_KEY?: string;
      PCR_ROOM_URL?: string;
      PCR_PASSPHRASE?: string;
    };

    // Build environment variables
    const envVars: Array<{ key: string; value: string }> = [];
    
    if (params.env_vars) {
      Object.entries(params.env_vars).forEach(([key, value]) => {
        envVars.push({ key, value });
      });
    }

    // Add PCR connection if enabled and configured
    if (params.connect_pcr && vars.PCR_ROOM_URL && vars.PCR_PASSPHRASE) {
      const agencyId = ctx.agent.info.agencyId;
      const roomUrl = `${vars.PCR_ROOM_URL}/room/${agencyId}-${params.name}`;
      envVars.push({ key: "PCR_ROOM_URL", value: roomUrl });
      envVars.push({ key: "PCR_PASSPHRASE", value: vars.PCR_PASSPHRASE });
      
      // Add startup script to install and run PCR
      const pcrStartupScript = `
#!/bin/bash
set -e
if [ -n "$PCR_ROOM_URL" ] && [ -n "$PCR_PASSPHRASE" ]; then
  cd /tmp
  git clone --depth 1 https://github.com/deathbyknowledge/personal-compute-relay.git
  cd personal-compute-relay/pcr-local
  npm install --production
  npm run build
  nohup node dist/cli.js "$PCR_ROOM_URL" "$PCR_PASSPHRASE" > /var/log/pcr.log 2>&1 &
fi
`.trim();
      envVars.push({ key: "PCR_STARTUP_SCRIPT", value: pcrStartupScript });
    }

    const body = {
      pod: {
        cloudId: params.cloud_id,
        gpuType: params.gpu_type,
        gpuCount: params.gpu_count,
        socket: params.socket,
        name: params.name,
        diskSize: params.disk_size ?? 100,
        image: params.image ?? "ubuntu_22_cuda_12",
        dataCenterId: params.data_center_id,
        envVars: envVars.length > 0 ? envVars : undefined,
        autoRestart: params.auto_restart ?? false,
      },
      provider: {
        type: params.provider,
      },
    };

    const result = await piRequest<PodResponse>(vars, "/pods/", {
      method: "POST",
      body: JSON.stringify(body),
    });

    // Format response
    return JSON.stringify({
      id: result.id,
      name: result.name,
      status: result.status,
      gpu: `${result.gpuCount}x ${result.gpuName}`,
      price_hr: `$${result.priceHr}/hr`,
      image: result.environmentType,
      ssh_connection: result.sshConnection,
      ip: result.ip,
      pcr_room: params.connect_pcr && vars.PCR_ROOM_URL
        ? `${vars.PCR_ROOM_URL}/room/${ctx.agent.info.agencyId}-${params.name}`
        : null,
      message: "Pod is provisioning. Use get_pod to check status.",
    }, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// List all pods
export const list_pods = tool({
  name: "list_pods",
  description: "List all your GPU pods on Prime Intellect with their status and details.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({}),
  execute: async (_, ctx) => {
    const result = await piRequest<PodResponse[] | { pods: PodResponse[] }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/pods/"
    );

    // Handle both array and { pods: [...] } response formats
    const podList = Array.isArray(result) ? result : (result.pods || []);

    const pods = podList.map((pod) => ({
      id: pod.id,
      name: pod.name,
      status: pod.status,
      gpu: `${pod.gpuCount}x ${pod.gpuName}`,
      price_hr: `$${pod.priceHr}/hr`,
      created: pod.createdAt,
      ssh: pod.sshConnection,
      ip: pod.ip,
    }));

    return JSON.stringify({ pods, count: pods.length }, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// Get single pod details
export const get_pod = tool({
  name: "get_pod",
  description: "Get detailed information about a specific pod including status, connection details, and logs.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({
    pod_id: z.string().describe("Pod ID to query"),
  }),
  execute: async (params, ctx) => {
    const result = await piRequest<PodResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/pods/${params.pod_id}`
    );

    return JSON.stringify({
      id: result.id,
      name: result.name,
      status: result.status,
      installation_status: result.installationStatus,
      installation_progress: result.installationProgress,
      gpu: `${result.gpuCount}x ${result.gpuName}`,
      price_hr: `$${result.priceHr}/hr`,
      created: result.createdAt,
      ssh_connection: result.sshConnection,
      ip: result.ip,
      resources: result.resources,
      is_active: result.status === "ACTIVE",
    }, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// Delete a pod
export const delete_pod = tool({
  name: "delete_pod",
  description: "Terminate and delete a GPU pod. This action cannot be undone.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({
    pod_id: z.string().describe("Pod ID to delete"),
    confirm: z
      .boolean()
      .describe("Must be true to confirm deletion"),
  }),
  execute: async (params, ctx) => {
    if (!params.confirm) {
      return "Deletion not confirmed. Set confirm: true to delete the pod.";
    }

    await piRequest<void>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/pods/${params.pod_id}`,
      { method: "DELETE" }
    );

    return JSON.stringify({
      success: true,
      message: `Pod ${params.pod_id} has been deleted.`,
    });
  },
  tags: ["prime", "prime-compute"],
});

// Get pod logs
export const get_pod_logs = tool({
  name: "get_pod_logs",
  description: "Retrieve logs from a running pod for debugging and monitoring.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({
    pod_id: z.string().describe("Pod ID"),
    tail: z.number().optional().describe("Number of lines to return (default: 100)"),
  }),
  execute: async (params, ctx) => {
    const query = new URLSearchParams();
    query.set("tail", String(params.tail ?? 100));

    const result = await piRequest<unknown>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/pods/${params.pod_id}/logs?${query.toString()}`
    );

    return JSON.stringify(result, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// Create a disk for persistent storage
export const create_disk = tool({
  name: "create_disk",
  description: `Create a persistent network-attached disk for storing datasets, checkpoints, and models.
Disks persist across pod restarts and can be attached to new pods.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({
    name: z.string().describe("Disk name"),
    size_gb: z.number().describe("Disk size in GB"),
    region: z.string().optional().describe("Region for the disk"),
  }),
  execute: async (params, ctx) => {
    const body = {
      name: params.name,
      size: params.size_gb,
      region: params.region,
    };

    const result = await piRequest<DiskResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/disks/",
      { method: "POST", body: JSON.stringify(body) }
    );

    return JSON.stringify({
      id: result.id,
      name: result.name,
      size_gb: result.size,
      status: result.status,
      region: result.region,
      message: "Disk created. Attach it to pods during creation.",
    }, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// List disks
export const list_disks = tool({
  name: "list_disks",
  description: "List all your persistent disks.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for compute access" },
  ],
  inputSchema: z.object({}),
  execute: async (_, ctx) => {
    const result = await piRequest<DiskResponse[]>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/disks/"
    );

    return JSON.stringify(result, null, 2);
  },
  tags: ["prime", "prime-compute"],
});

// =============================================================================
// Pod Execution via Home Server PCR Bridge
// =============================================================================
// These tools route commands through a home server that has SSH access to pods.
// The home server runs pcr-local and exposes MCP tools (bash, read_file, write_file).
// Agent calls these tools → PCR Worker → Home Server → SSH → Pod

// MCP tool call response format (from Agency)
interface McpToolCallResponse {
  content?: Array<{ type: string; text?: string }>;
  toolResult?: unknown;
  isError?: boolean;
}

// MCP server info from Agency
interface McpServerInfo {
  id: string;
  name: string;
  url: string;
  status: string;
}

// ToolContext type (simplified for this file)
interface PodExecContext {
  agent: {
    info: { agencyId: string };
    vars: Record<string, unknown>;
    exports: { Agency: unknown };
  };
}

/**
 * Find the PCR MCP server by matching PCR_BRIDGE_URL against registered MCP servers.
 */
async function findPcrServer(
  agencyStub: { fetch: (req: Request) => Promise<Response> },
  bridgeUrl: string
): Promise<string> {
  // List all MCP servers
  const listRes = await agencyStub.fetch(new Request("http://do/mcp"));
  
  if (!listRes.ok) {
    throw new Error(`Failed to list MCP servers: ${await listRes.text()}`);
  }
  
  const { servers } = await listRes.json() as { servers: McpServerInfo[] };
  
  // Find server whose URL starts with PCR_BRIDGE_URL
  const pcrServer = servers.find(s => s.url.startsWith(bridgeUrl));
  
  if (!pcrServer) {
    throw new Error(
      `No MCP server found matching PCR_BRIDGE_URL "${bridgeUrl}". ` +
      `Add your PCR as an MCP server to the Agency first. ` +
      `Available servers: ${servers.map(s => s.url).join(", ") || "(none)"}`
    );
  }
  
  if (pcrServer.status !== "ready") {
    throw new Error(
      `PCR MCP server "${pcrServer.name}" is not ready (status: ${pcrServer.status}). ` +
      `Make sure pcr-local is running on your home server.`
    );
  }
  
  return pcrServer.id;
}

/**
 * Call an MCP tool via the Agency's MCP infrastructure.
 * 
 * Auto-discovers the PCR MCP server by matching PCR_BRIDGE_URL against
 * registered MCP servers in the Agency.
 * 
 * SETUP: 
 * 1. Add your PCR as an MCP server to the Agency
 * 2. Set PCR_BRIDGE_URL to the base URL (e.g., https://pcr.example.com/room/home)
 */
async function callPcrMcp(
  ctx: PodExecContext,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const bridgeUrl = ctx.agent.vars.PCR_BRIDGE_URL as string | undefined;
  
  if (!bridgeUrl) {
    throw new Error(
      "PCR_BRIDGE_URL is required. Set it to your PCR room URL " +
      "(e.g., https://pcr.example.com/room/home-server)"
    );
  }

  // Import getAgentByName dynamically to avoid circular deps
  const { getAgentByName } = await import("agents");
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agencyStub = await getAgentByName(
    ctx.agent.exports.Agency as any,
    ctx.agent.info.agencyId
  );

  // Find the PCR server by matching URL
  const serverId = await findPcrServer(agencyStub, bridgeUrl);

  const res = await agencyStub.fetch(
    new Request("http://do/mcp/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serverId,
        toolName,
        arguments: args,
      }),
    })
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`MCP call failed: ${errorText}`);
  }

  const result = await res.json() as McpToolCallResponse;

  if (result.isError) {
    const errorText = result.content?.find(c => c.type === "text")?.text;
    throw new Error(errorText || "MCP tool returned an error");
  }

  // Extract text content
  if (result.content) {
    const textParts = result.content
      .filter(c => c.type === "text")
      .map(c => c.text)
      .filter(Boolean);
    return textParts.join("\n") || JSON.stringify(result.content);
  }

  if (result.toolResult !== undefined) {
    return typeof result.toolResult === "string"
      ? result.toolResult
      : JSON.stringify(result.toolResult);
  }

  return "Command completed with no output";
}

// Execute command on a pod via PCR bridge
export const pod_exec = tool({
  name: "pod_exec",
  description: `Execute a shell command on a GPU pod via the PCR bridge.
The command is routed through your home server which SSHs into the pod.
IMPORTANT: Pod must be ACTIVE with SSH available. Use get_pod to check status.

SETUP: Add your PCR as an MCP server to the Agency, then set PCR_BRIDGE_URL to the base room URL.

This is the primary way to run commands on GPU pods for:
- Running training scripts
- Installing packages
- Checking GPU status (nvidia-smi)
- Managing files and processes`,
  varHints: [
    { name: "PCR_BRIDGE_URL", required: true, description: "Base URL of your PCR room (e.g., https://pcr.example.com/room/home). The tool auto-discovers the MCP server." },
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key" },
  ],
  inputSchema: z.object({
    pod_id: z.string().describe("Pod ID to execute command on"),
    command: z.string().describe("Shell command to execute (e.g., 'nvidia-smi', 'python train.py')"),
    workdir: z.string().optional().describe("Working directory for command"),
    timeout_seconds: z.number().optional().default(300).describe("Command timeout (default: 5 minutes)"),
  }),
  execute: async (params, ctx) => {
    // First verify the pod exists and get SSH info
    const pod = await piRequest<PodResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/pods/${params.pod_id}`
    );

    if (pod.status !== "ACTIVE") {
      throw new Error(`Pod is not ACTIVE (current status: ${pod.status}). Wait for pod to be ready.`);
    }

    if (!pod.sshConnection) {
      throw new Error("Pod does not have SSH connection info yet. Wait a moment and try again.");
    }

    // Build the SSH command that will run on the home server
    // The home server's bash tool will execute this
    const sshCommand = params.workdir
      ? `ssh -o StrictHostKeyChecking=no ${pod.sshConnection} "cd ${params.workdir} && ${params.command}"`
      : `ssh -o StrictHostKeyChecking=no ${pod.sshConnection} "${params.command}"`;

    const result = await callPcrMcp(ctx, "bash", {
      command: sshCommand,
      timeout: params.timeout_seconds,
    });

    return JSON.stringify({
      pod_id: params.pod_id,
      pod_name: pod.name,
      command: params.command,
      output: result,
    }, null, 2);
  },
  tags: ["prime", "prime-compute", "pod-exec"],
});

// Write file to pod via PCR bridge
export const pod_write_file = tool({
  name: "pod_write_file",
  description: `Write a file to a GPU pod via the PCR bridge.
Use this to upload scripts, configs, or data to the pod.

SETUP: Add your PCR as an MCP server to the Agency, then set PCR_BRIDGE_URL to the base room URL.`,
  varHints: [
    { name: "PCR_BRIDGE_URL", required: true, description: "Base URL of your PCR room (e.g., https://pcr.example.com/room/home). The tool auto-discovers the MCP server." },
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key" },
  ],
  inputSchema: z.object({
    pod_id: z.string().describe("Pod ID"),
    path: z.string().describe("Remote file path on the pod"),
    content: z.string().describe("File content to write"),
  }),
  execute: async (params, ctx) => {
    // Get pod SSH info
    const pod = await piRequest<PodResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/pods/${params.pod_id}`
    );

    if (pod.status !== "ACTIVE" || !pod.sshConnection) {
      throw new Error(`Pod is not ready (status: ${pod.status})`);
    }

    // Use heredoc to write file content via SSH
    const sshCommand = `ssh -o StrictHostKeyChecking=no ${pod.sshConnection} "cat > ${params.path}" << 'EOFCONTENT'
${params.content}
EOFCONTENT`;

    await callPcrMcp(ctx as PodExecContext, "bash", { command: sshCommand });

    return JSON.stringify({
      pod_id: params.pod_id,
      path: params.path,
      bytes_written: params.content.length,
      success: true,
    }, null, 2);
  },
  tags: ["prime", "prime-compute", "pod-exec"],
});

// Read file from pod via PCR bridge
export const pod_read_file = tool({
  name: "pod_read_file",
  description: `Read a file from a GPU pod via the PCR bridge.
Use this to retrieve outputs, logs, or results from the pod.

SETUP: Add your PCR as an MCP server to the Agency, then set PCR_BRIDGE_URL to the base room URL.`,
  varHints: [
    { name: "PCR_BRIDGE_URL", required: true, description: "Base URL of your PCR room (e.g., https://pcr.example.com/room/home). The tool auto-discovers the MCP server." },
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key" },
  ],
  inputSchema: z.object({
    pod_id: z.string().describe("Pod ID"),
    path: z.string().describe("Remote file path to read"),
    tail_lines: z.number().optional().describe("Only return last N lines (for large files)"),
  }),
  execute: async (params, ctx) => {
    // Get pod SSH info
    const pod = await piRequest<PodResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/pods/${params.pod_id}`
    );

    if (pod.status !== "ACTIVE" || !pod.sshConnection) {
      throw new Error(`Pod is not ready (status: ${pod.status})`);
    }

    const catCommand = params.tail_lines
      ? `tail -n ${params.tail_lines} ${params.path}`
      : `cat ${params.path}`;

    const sshCommand = `ssh -o StrictHostKeyChecking=no ${pod.sshConnection} "${catCommand}"`;
    const content = await callPcrMcp(ctx as PodExecContext, "bash", { command: sshCommand });

    return JSON.stringify({
      pod_id: params.pod_id,
      path: params.path,
      content,
    }, null, 2);
  },
  tags: ["prime", "prime-compute", "pod-exec"],
});

// Check GPU status on pod
export const pod_gpu_status = tool({
  name: "pod_gpu_status",
  description: `Check GPU status and utilization on a pod.
Runs nvidia-smi to show GPU memory, utilization, temperature, and running processes.

SETUP: Add your PCR as an MCP server to the Agency, then set PCR_BRIDGE_URL to the base room URL.`,
  varHints: [
    { name: "PCR_BRIDGE_URL", required: true, description: "Base URL of your PCR room (e.g., https://pcr.example.com/room/home). The tool auto-discovers the MCP server." },
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key" },
  ],
  inputSchema: z.object({
    pod_id: z.string().describe("Pod ID"),
  }),
  execute: async (params, ctx) => {
    // Get pod SSH info
    const pod = await piRequest<PodResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/pods/${params.pod_id}`
    );

    if (pod.status !== "ACTIVE" || !pod.sshConnection) {
      throw new Error(`Pod is not ready (status: ${pod.status})`);
    }

    const sshCommand = `ssh -o StrictHostKeyChecking=no ${pod.sshConnection} "nvidia-smi"`;
    const output = await callPcrMcp(ctx as PodExecContext, "bash", { command: sshCommand });

    return JSON.stringify({
      pod_id: params.pod_id,
      pod_name: pod.name,
      gpu: `${pod.gpuCount}x ${pod.gpuName}`,
      nvidia_smi: output,
    }, null, 2);
  },
  tags: ["prime", "prime-compute", "pod-exec"],
});
