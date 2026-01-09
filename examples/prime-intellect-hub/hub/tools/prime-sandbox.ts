import { tool, z } from "agents-hub";

const PI_API_BASE = "https://api.primeintellect.ai/api/v1";

// Type definitions
interface SandboxResponse {
  id: string;
  name: string;
  dockerImage: string;
  startCommand: string | null;
  cpuCores: number;
  memoryGB: number;
  diskSizeGB: number;
  gpuCount: number;
  networkAccess: boolean;
  status: string;
  timeoutMinutes: number;
  createdAt: string;
  startedAt: string | null;
  terminatedAt: string | null;
  exitCode: number | null;
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

// Create a sandbox for code execution
export const create_sandbox = tool({
  name: "create_sandbox",
  description: `Create a code execution sandbox for RL environments and quick experiments.
Sandboxes are lightweight, fast-starting containers ideal for:
- Running RL environment rollouts
- Code execution for benchmarks
- Quick experiments without full GPU pods
Max timeout: 24 hours (1440 minutes)`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    name: z.string().describe("Sandbox name (1-100 chars)"),
    docker_image: z.string().describe("Docker image to run (e.g., 'python:3.11', 'pytorch/pytorch:2.0.0-cuda11.7-cudnn8-runtime')"),
    start_command: z
      .string()
      .optional()
      .describe("Command to run in container"),
    cpu_cores: z
      .number()
      .optional()
      .default(2)
      .describe("CPU cores (1-16)"),
    memory_gb: z
      .number()
      .optional()
      .default(4)
      .describe("Memory in GB (1-64)"),
    disk_size_gb: z
      .number()
      .optional()
      .default(10)
      .describe("Disk size in GB (1-1000)"),
    gpu_count: z
      .number()
      .optional()
      .default(0)
      .describe("Number of GPUs (0-8)"),
    timeout_minutes: z
      .number()
      .optional()
      .default(60)
      .describe("Max execution time in minutes (1-1440)"),
    network_access: z
      .boolean()
      .optional()
      .default(true)
      .describe("Allow outbound internet access"),
    environment_vars: z
      .record(z.string())
      .optional()
      .describe("Environment variables"),
    labels: z
      .array(z.string())
      .optional()
      .describe("Tags/labels for organization"),
  }),
  execute: async (params, ctx) => {
    const body = {
      name: params.name,
      docker_image: params.docker_image,
      start_command: params.start_command,
      cpu_cores: params.cpu_cores,
      memory_gb: params.memory_gb,
      disk_size_gb: params.disk_size_gb,
      gpu_count: params.gpu_count,
      timeout_minutes: params.timeout_minutes,
      network_access: params.network_access,
      environment_vars: params.environment_vars,
      labels: params.labels,
    };

    const result = await piRequest<SandboxResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/sandbox",
      { method: "POST", body: JSON.stringify(body) }
    );

    return JSON.stringify({
      id: result.id,
      name: result.name,
      status: result.status,
      image: result.dockerImage,
      resources: {
        cpu: result.cpuCores,
        memory_gb: result.memoryGB,
        disk_gb: result.diskSizeGB,
        gpus: result.gpuCount,
      },
      timeout_minutes: result.timeoutMinutes,
      created: result.createdAt,
      message: "Sandbox created. Use get_sandbox to check when RUNNING.",
    }, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});

// List sandboxes
export const list_sandboxes = tool({
  name: "list_sandboxes",
  description: "List all your sandboxes with their status.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    status: z
      .enum(["PENDING", "PROVISIONING", "RUNNING", "STOPPED", "ERROR", "TERMINATED"])
      .optional()
      .describe("Filter by status"),
    labels: z
      .array(z.string())
      .optional()
      .describe("Filter by labels"),
  }),
  execute: async (params, ctx) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.labels) {
      params.labels.forEach((l) => query.append("labels", l));
    }

    const result = await piRequest<SandboxResponse[]>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox?${query.toString()}`
    );

    const sandboxes = result.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      image: s.dockerImage,
      created: s.createdAt,
      exit_code: s.exitCode,
    }));

    return JSON.stringify({ sandboxes, count: sandboxes.length }, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});

// Get sandbox details
export const get_sandbox = tool({
  name: "get_sandbox",
  description: "Get detailed information about a specific sandbox.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_id: z.string().describe("Sandbox ID"),
  }),
  execute: async (params, ctx) => {
    const result = await piRequest<SandboxResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox/${params.sandbox_id}`
    );

    return JSON.stringify({
      id: result.id,
      name: result.name,
      status: result.status,
      image: result.dockerImage,
      command: result.startCommand,
      resources: {
        cpu: result.cpuCores,
        memory_gb: result.memoryGB,
        disk_gb: result.diskSizeGB,
        gpus: result.gpuCount,
      },
      network_access: result.networkAccess,
      timeout_minutes: result.timeoutMinutes,
      created: result.createdAt,
      started: result.startedAt,
      terminated: result.terminatedAt,
      exit_code: result.exitCode,
      is_running: result.status === "RUNNING",
    }, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});

// Delete sandbox
export const delete_sandbox = tool({
  name: "delete_sandbox",
  description: "Delete a sandbox. Running sandboxes will be terminated.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_id: z.string().describe("Sandbox ID to delete"),
  }),
  execute: async (params, ctx) => {
    await piRequest<void>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox/${params.sandbox_id}`,
      { method: "DELETE" }
    );

    return JSON.stringify({
      success: true,
      message: `Sandbox ${params.sandbox_id} has been deleted.`,
    });
  },
  tags: ["prime", "prime-sandbox"],
});

// Bulk delete sandboxes
export const bulk_delete_sandboxes = tool({
  name: "bulk_delete_sandboxes",
  description: "Delete multiple sandboxes at once. Useful for cleanup.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_ids: z.array(z.string()).describe("List of sandbox IDs to delete"),
    confirm: z.boolean().describe("Must be true to confirm deletion"),
  }),
  execute: async (params, ctx) => {
    if (!params.confirm) {
      return "Deletion not confirmed. Set confirm: true to delete sandboxes.";
    }

    await piRequest<void>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/sandbox",
      { 
        method: "DELETE",
        body: JSON.stringify({ sandbox_ids: params.sandbox_ids }),
      }
    );

    return JSON.stringify({
      success: true,
      message: `Deleted ${params.sandbox_ids.length} sandboxes.`,
    });
  },
  tags: ["prime", "prime-sandbox"],
});

// Get sandbox auth for gateway access
export const get_sandbox_auth = tool({
  name: "get_sandbox_auth",
  description: `Get authentication credentials for direct sandbox gateway access.
Returns a JWT token and gateway URL for exec, file operations, etc.
Token expires after 30 minutes - refresh as needed.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_id: z.string().describe("Sandbox ID"),
  }),
  execute: async (params, ctx) => {
    const result = await piRequest<{
      token: string;
      gateway_url: string;
      user_ns: string;
      job_id: string;
      expires_at: string;
    }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox/${params.sandbox_id}/auth`,
      { method: "POST" }
    );

    return JSON.stringify({
      sandbox_id: params.sandbox_id,
      gateway_url: result.gateway_url,
      user_ns: result.user_ns,
      job_id: result.job_id,
      token: result.token,
      expires_at: result.expires_at,
      exec_url: `${result.gateway_url}/${result.user_ns}/${result.job_id}/exec`,
      files_url: `${result.gateway_url}/${result.user_ns}/${result.job_id}/files`,
    }, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});

// Execute command in sandbox
export const sandbox_exec = tool({
  name: "sandbox_exec",
  description: `Execute a command in a running sandbox.
Returns stdout, stderr, exit code, and execution duration.
IMPORTANT: Sandbox must be RUNNING. Use get_sandbox to check status first.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_id: z.string().describe("Sandbox ID"),
    command: z.string().describe("Shell command to execute (e.g., 'ls -la', 'python script.py')"),
    timeout_seconds: z.number().optional().default(60).describe("Command timeout in seconds"),
    workdir: z.string().optional().describe("Working directory for command execution"),
  }),
  execute: async (params, ctx) => {
    // First get auth credentials
    const auth = await piRequest<{
      token: string;
      gateway_url: string;
      user_ns: string;
      job_id: string;
    }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox/${params.sandbox_id}/auth`,
      { method: "POST" }
    );

    // Execute command via gateway
    const execUrl = `${auth.gateway_url}/${auth.user_ns}/${auth.job_id}/exec`;
    const execRes = await fetch(execUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        command: params.command,
        timeout: params.timeout_seconds,
        workdir: params.workdir,
      }),
    });

    if (!execRes.ok) {
      const text = await execRes.text();
      throw new Error(`Sandbox exec failed (${execRes.status}): ${text}`);
    }

    const result = await execRes.json() as {
      stdout: string;
      stderr: string;
      exit_code: number;
      duration_ms: number;
    };

    return JSON.stringify({
      sandbox_id: params.sandbox_id,
      command: params.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exit_code: result.exit_code,
      duration_ms: result.duration_ms,
      success: result.exit_code === 0,
    }, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});

// Write file to sandbox
export const sandbox_write_file = tool({
  name: "sandbox_write_file",
  description: `Write a file to the sandbox filesystem.
Use this to upload code, configs, or data to the sandbox.
Files are written to /sandbox-workspace by default.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_id: z.string().describe("Sandbox ID"),
    path: z.string().describe("File path (e.g., '/sandbox-workspace/script.py')"),
    content: z.string().describe("File content to write"),
  }),
  execute: async (params, ctx) => {
    // Get auth credentials
    const auth = await piRequest<{
      token: string;
      gateway_url: string;
      user_ns: string;
      job_id: string;
    }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox/${params.sandbox_id}/auth`,
      { method: "POST" }
    );

    // Write file via gateway
    const filesUrl = `${auth.gateway_url}/${auth.user_ns}/${auth.job_id}/files`;
    const writeRes = await fetch(filesUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: params.path,
        content: params.content,
      }),
    });

    if (!writeRes.ok) {
      const text = await writeRes.text();
      throw new Error(`File write failed (${writeRes.status}): ${text}`);
    }

    return JSON.stringify({
      sandbox_id: params.sandbox_id,
      path: params.path,
      bytes_written: params.content.length,
      success: true,
    }, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});

// Read file from sandbox
export const sandbox_read_file = tool({
  name: "sandbox_read_file",
  description: `Read a file from the sandbox filesystem.
Use this to retrieve outputs, logs, or results from the sandbox.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_id: z.string().describe("Sandbox ID"),
    path: z.string().describe("File path to read"),
  }),
  execute: async (params, ctx) => {
    // Get auth credentials
    const auth = await piRequest<{
      token: string;
      gateway_url: string;
      user_ns: string;
      job_id: string;
    }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox/${params.sandbox_id}/auth`,
      { method: "POST" }
    );

    // Read file via gateway
    const filesUrl = `${auth.gateway_url}/${auth.user_ns}/${auth.job_id}/files?path=${encodeURIComponent(params.path)}`;
    const readRes = await fetch(filesUrl, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (!readRes.ok) {
      const text = await readRes.text();
      throw new Error(`File read failed (${readRes.status}): ${text}`);
    }

    const result = await readRes.json() as { content: string };

    return JSON.stringify({
      sandbox_id: params.sandbox_id,
      path: params.path,
      content: result.content,
    }, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});

// Get sandbox logs
export const get_sandbox_logs = tool({
  name: "get_sandbox_logs",
  description: "Retrieve logs from a sandbox for debugging.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_id: z.string().describe("Sandbox ID"),
    tail: z.number().optional().describe("Number of lines (default: 100)"),
  }),
  execute: async (params, ctx) => {
    const query = new URLSearchParams();
    query.set("tail", String(params.tail ?? 100));

    const result = await piRequest<{ logs: string }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox/${params.sandbox_id}/logs?${query.toString()}`
    );

    return JSON.stringify(result, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});

// Expose a port on sandbox
export const expose_sandbox_port = tool({
  name: "expose_sandbox_port",
  description: "Expose a port on a running sandbox to make it accessible externally.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for sandbox access" },
  ],
  inputSchema: z.object({
    sandbox_id: z.string().describe("Sandbox ID"),
    port: z.number().describe("Port number to expose"),
    protocol: z.enum(["http", "tcp"]).optional().default("http"),
  }),
  execute: async (params, ctx) => {
    const result = await piRequest<{ url: string }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/sandbox/${params.sandbox_id}/ports`,
      {
        method: "POST",
        body: JSON.stringify({
          port: params.port,
          protocol: params.protocol,
        }),
      }
    );

    return JSON.stringify({
      sandbox_id: params.sandbox_id,
      port: params.port,
      external_url: result.url,
      message: "Port exposed. Access via the external URL.",
    }, null, 2);
  },
  tags: ["prime", "prime-sandbox"],
});
