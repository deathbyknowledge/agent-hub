import { tool, z } from "agents-hub";

// Prime Inference API has a different base URL
const PI_INFERENCE_BASE = "https://api.pinference.ai/api/v1";


// Helper to make authenticated requests
async function piInferenceRequest<T>(
  env: { PRIME_API_KEY?: string },
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const apiKey = env.PRIME_API_KEY;
  if (!apiKey) {
    throw new Error("PRIME_API_KEY is required. Set it in agency variables.");
  }

  const res = await fetch(`${PI_INFERENCE_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prime Inference API error (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// List available models
export const list_inference_models = tool({
  name: "list_inference_models",
  description: "List available models on Prime Intellect inference API.",
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for inference access" },
  ],
  inputSchema: z.object({}),
  execute: async (_, ctx) => {
    const result = await piInferenceRequest<{ data: ModelInfo[] }>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/models"
    );

    const models = result.data.map((m) => ({
      id: m.id,
      owned_by: m.owned_by,
    }));

    return JSON.stringify({ models }, null, 2);
  },
  tags: ["prime", "prime-inference"],
});

interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}