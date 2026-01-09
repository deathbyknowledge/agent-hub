import { tool, z } from "agents-hub";

const PI_API_BASE = "https://api.primeintellect.ai/api/v1";

// Type definitions
interface EvaluationResponse {
  evaluation_id: string;
  name: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT" | "CANCELLED";
  eval_type: "suite" | "training" | "environment";
  created_at: string;
  environment_ids: string[] | null;
  suite_id: string | null;
  run_id: string | null;
  version_id: string | null;
}

interface EvaluationDetail extends EvaluationResponse {
  model_name: string | null;
  dataset: string | null;
  framework: string | null;
  description: string | null;
  tags: string[];
  metrics: Record<string, unknown>;
  is_public: boolean;
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

// Create an evaluation
export const create_evaluation = tool({
  name: "create_evaluation",
  description: `Create a new evaluation run on Prime Intellect Environments Hub.
Supports:
- Environment evaluations: Specify environment IDs from the Hub
- Suite evaluations: Run a predefined suite of benchmarks
- Training evaluations: Evaluate a PRIME-RL training run

Common environments: AIME, AMC, MATH, HumanEval, MBPP, GPQA, BBH, MMLU
Visit hub.primeintellect.ai for the full list of 500+ environments.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for evaluation access" },
  ],
  inputSchema: z.object({
    name: z.string().describe("Evaluation name"),
    environments: z
      .array(z.object({
        id: z.string().describe("Environment ID from Environments Hub"),
        version_id: z.string().optional().describe("Specific version (optional)"),
      }))
      .optional()
      .describe("List of environments to evaluate on"),
    suite_id: z
      .string()
      .optional()
      .describe("Suite ID for predefined benchmark suites"),
    run_id: z
      .string()
      .optional()
      .describe("PRIME-RL run ID for training evaluations"),
    model_name: z
      .string()
      .optional()
      .describe("Model being evaluated"),
    inference_model: z
      .string()
      .optional()
      .describe("Prime Inference model ID to use"),
    eval_config: z
      .object({
        num_examples: z.number().optional().describe("Number of examples to evaluate"),
        rollouts_per_example: z.number().optional().default(1).describe("Rollouts per example"),
        timeout_minutes: z.number().optional().default(60).describe("Timeout per example"),
        allow_sandbox_access: z.boolean().optional().default(false).describe("Enable sandbox for code execution"),
        allow_instances_access: z.boolean().optional().default(false).describe("Enable instance access"),
      })
      .optional(),
    description: z.string().optional().describe("Evaluation description"),
    tags: z.array(z.string()).optional().describe("Tags for organization"),
    is_public: z.boolean().optional().default(false).describe("Make results public on environment pages"),
  }),
  execute: async (params, ctx) => {
    const body = {
      name: params.name,
      environments: params.environments,
      suite_id: params.suite_id,
      run_id: params.run_id,
      model_name: params.model_name,
      inference_model: params.inference_model,
      eval_config: params.eval_config,
      description: params.description,
      tags: params.tags,
      is_public: params.is_public,
    };

    const result = await piRequest<EvaluationResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/evaluations/",
      { method: "POST", body: JSON.stringify(body) }
    );

    return JSON.stringify({
      evaluation_id: result.evaluation_id,
      name: result.name,
      status: result.status,
      type: result.eval_type,
      environments: result.environment_ids,
      created: result.created_at,
      message: "Evaluation created. Use get_evaluation to check progress.",
    }, null, 2);
  },
  tags: ["prime", "prime-evals"],
});

// List evaluations
export const list_evaluations = tool({
  name: "list_evaluations",
  description: "List your evaluations with optional filters.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for evaluation access" },
  ],
  inputSchema: z.object({
    status: z
      .enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT", "CANCELLED"])
      .optional()
      .describe("Filter by status"),
    model_name: z.string().optional().describe("Filter by model name"),
    page: z.number().optional().describe("Page number (default: 1)"),
    page_size: z.number().optional().describe("Results per page (default: 20)"),
  }),
  execute: async (params, ctx) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.model_name) query.set("model_name", params.model_name);
    query.set("page", String(params.page ?? 1));
    query.set("page_size", String(params.page_size ?? 20));

    const result = await piRequest<
      EvaluationResponse[] | { items?: EvaluationResponse[]; evaluations?: EvaluationResponse[]; total?: number }
    >(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/evaluations/?${query.toString()}`
    );

    // Handle different response formats: array, { items: [...] }, or { evaluations: [...] }
    const evalList = Array.isArray(result) 
      ? result 
      : (result.items || result.evaluations || []);
    const total = Array.isArray(result) ? evalList.length : (result.total ?? evalList.length);

    const evals = evalList.map((e) => ({
      id: e.evaluation_id,
      name: e.name,
      status: e.status,
      type: e.eval_type,
      created: e.created_at,
    }));

    return JSON.stringify({ 
      evaluations: evals, 
      total,
      page: params.page,
    }, null, 2);
  },
  tags: ["prime", "prime-evals"],
});

// Get evaluation details
export const get_evaluation = tool({
  name: "get_evaluation",
  description: "Get detailed information and results for an evaluation.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for evaluation access" },
  ],
  inputSchema: z.object({
    evaluation_id: z.string().describe("Evaluation ID"),
  }),
  execute: async (params, ctx) => {
    const result = await piRequest<EvaluationDetail>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/evaluations/${params.evaluation_id}`
    );

    return JSON.stringify({
      id: result.evaluation_id,
      name: result.name,
      status: result.status,
      type: result.eval_type,
      model: result.model_name,
      dataset: result.dataset,
      framework: result.framework,
      description: result.description,
      environments: result.environment_ids,
      metrics: result.metrics,
      tags: result.tags,
      is_public: result.is_public,
      created: result.created_at,
      is_complete: result.status === "COMPLETED",
      is_running: result.status === "RUNNING",
    }, null, 2);
  },
  tags: ["prime", "prime-evals"],
});

// Push samples to evaluation
export const push_samples = tool({
  name: "push_samples",
  description: `Push evaluation samples/results to an evaluation.
Use this for custom evaluations where you're running inference yourself.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for evaluation access" },
  ],
  inputSchema: z.object({
    evaluation_id: z.string().describe("Evaluation ID"),
    samples: z
      .array(z.object({
        input: z.string().describe("Input/prompt"),
        output: z.string().describe("Model output"),
        expected: z.string().optional().describe("Expected output (if known)"),
        correct: z.boolean().optional().describe("Whether output is correct"),
        metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
      }))
      .describe("Samples to push"),
  }),
  execute: async (params, ctx) => {
    const result = await piRequest<{ count: number }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/evaluations/${params.evaluation_id}/samples`,
      {
        method: "POST",
        body: JSON.stringify({ samples: params.samples }),
      }
    );

    return JSON.stringify({
      evaluation_id: params.evaluation_id,
      samples_added: result.count,
      message: "Samples pushed successfully.",
    }, null, 2);
  },
  tags: ["prime", "prime-evals"],
});

// Finalize evaluation
export const finalize_evaluation = tool({
  name: "finalize_evaluation",
  description: `Finalize an evaluation to compute final metrics and mark as complete.
Call this after pushing all samples for custom evaluations.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for evaluation access" },
  ],
  inputSchema: z.object({
    evaluation_id: z.string().describe("Evaluation ID to finalize"),
  }),
  execute: async (params, ctx) => {
    const result = await piRequest<EvaluationDetail>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/evaluations/${params.evaluation_id}/finalize`,
      { method: "POST" }
    );

    return JSON.stringify({
      id: result.evaluation_id,
      status: result.status,
      metrics: result.metrics,
      message: "Evaluation finalized. Metrics computed.",
    }, null, 2);
  },
  tags: ["prime", "prime-evals"],
});

// Delete evaluation
export const delete_evaluation = tool({
  name: "delete_evaluation",
  description: "Delete an evaluation and all its data.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for evaluation access" },
  ],
  inputSchema: z.object({
    evaluation_id: z.string().describe("Evaluation ID to delete"),
    confirm: z.boolean().describe("Must be true to confirm deletion"),
  }),
  execute: async (params, ctx) => {
    if (!params.confirm) {
      return "Deletion not confirmed. Set confirm: true to delete.";
    }

    await piRequest<void>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/evaluations/${params.evaluation_id}`,
      { method: "DELETE" }
    );

    return JSON.stringify({
      success: true,
      message: `Evaluation ${params.evaluation_id} deleted.`,
    });
  },
  tags: ["prime", "prime-evals"],
});

// Get samples from evaluation
export const get_evaluation_samples = tool({
  name: "get_evaluation_samples",
  description: "Retrieve samples from an evaluation for analysis.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for evaluation access" },
  ],
  inputSchema: z.object({
    evaluation_id: z.string().describe("Evaluation ID"),
    page: z.number().optional().describe("Page number (default: 1)"),
    page_size: z.number().optional().describe("Results per page (default: 50)"),
    correct_only: z.boolean().optional().describe("Filter to correct samples only"),
    incorrect_only: z.boolean().optional().describe("Filter to incorrect samples only"),
  }),
  execute: async (params, ctx) => {
    const query = new URLSearchParams();
    query.set("page", String(params.page ?? 1));
    query.set("page_size", String(params.page_size ?? 50));
    if (params.correct_only) query.set("correct", "true");
    if (params.incorrect_only) query.set("correct", "false");

    const result = await piRequest<{ samples: unknown[]; total: number }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      `/evaluations/${params.evaluation_id}/samples?${query.toString()}`
    );

    return JSON.stringify({
      evaluation_id: params.evaluation_id,
      samples: result.samples,
      total: result.total,
      page: params.page,
    }, null, 2);
  },
  tags: ["prime", "prime-evals"],
});
