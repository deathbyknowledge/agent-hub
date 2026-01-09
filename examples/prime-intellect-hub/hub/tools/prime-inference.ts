import { tool, z } from "agents-hub";

// Prime Inference API has a different base URL
const PI_INFERENCE_BASE = "https://api.pinference.ai/api/v1";

// Type definitions
interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

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

// Chat completion with INTELLECT-3 and other models
export const chat_completion = tool({
  name: "chat_completion",
  description: `Generate text using Prime Intellect's inference API.
Available models include:
- PrimeIntellect/INTELLECT-3 (100B+ MoE, state-of-the-art reasoning)
- meta-llama/llama-3.1-70b-instruct
- meta-llama/llama-3.1-8b-instruct
Use this to query INTELLECT-3 for reasoning, code, math, or general tasks.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for inference access" },
  ],
  inputSchema: z.object({
    messages: z
      .array(z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      }))
      .describe("Conversation messages"),
    model: z
      .string()
      .optional()
      .default("PrimeIntellect/INTELLECT-3")
      .describe("Model ID (default: INTELLECT-3)"),
    temperature: z
      .number()
      .optional()
      .default(0.7)
      .describe("Sampling temperature (0-2, lower = more deterministic)"),
    max_tokens: z
      .number()
      .optional()
      .describe("Maximum tokens to generate"),
    stop: z
      .array(z.string())
      .optional()
      .describe("Stop sequences"),
  }),
  execute: async (params, ctx) => {
    const body = {
      model: params.model,
      messages: params.messages as ChatMessage[],
      temperature: params.temperature,
      max_tokens: params.max_tokens,
      stop: params.stop,
      stream: false,
    };

    const result = await piInferenceRequest<ChatCompletionResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/chat/completions",
      { method: "POST", body: JSON.stringify(body) }
    );

    const choice = result.choices?.[0];
    if (!choice) {
      throw new Error("No response generated from model");
    }
    
    return JSON.stringify({
      model: result.model,
      response: choice.message?.content ?? "",
      finish_reason: choice.finish_reason,
      // Usage may not always be present in the response
      ...(result.usage && {
        usage: {
          prompt_tokens: result.usage.prompt_tokens,
          completion_tokens: result.usage.completion_tokens,
          total_tokens: result.usage.total_tokens,
        },
      }),
    }, null, 2);
  },
  tags: ["prime", "prime-inference"],
});

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

// Helper tool to query INTELLECT-3 with a simple prompt
export const ask_intellect = tool({
  name: "ask_intellect",
  description: `Quick helper to ask INTELLECT-3 a question.
INTELLECT-3 is a 100B+ MoE model trained by Prime Intellect, excelling at:
- Mathematical reasoning (AIME-level problems)
- Code generation and debugging
- Scientific analysis
- General reasoning tasks`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for inference access" },
  ],
  inputSchema: z.object({
    question: z.string().describe("Question or prompt for INTELLECT-3"),
    system_prompt: z
      .string()
      .optional()
      .describe("Optional system prompt to set context"),
    temperature: z
      .number()
      .optional()
      .default(0.3)
      .describe("Temperature (lower for reasoning, higher for creativity)"),
  }),
  execute: async (params, ctx) => {
    const messages: ChatMessage[] = [];
    
    if (params.system_prompt) {
      messages.push({ role: "system", content: params.system_prompt });
    }
    
    messages.push({ role: "user", content: params.question });

    const body = {
      model: "PrimeIntellect/INTELLECT-3",
      messages,
      temperature: params.temperature,
      stream: false,
    };

    const result = await piInferenceRequest<ChatCompletionResponse>(
      ctx.agent.vars as { PRIME_API_KEY?: string },
      "/chat/completions",
      { method: "POST", body: JSON.stringify(body) }
    );

    return result.choices[0].message.content;
  },
  tags: ["prime", "prime-inference"],
});

// Batch completion for multiple prompts
export const batch_chat_completion = tool({
  name: "batch_chat_completion",
  description: `Run multiple chat completions in sequence.
Useful for processing multiple prompts with the same configuration.`,
  varHints: [
    { name: "PRIME_API_KEY", required: true, description: "Prime Intellect API key for inference access" },
  ],
  inputSchema: z.object({
    prompts: z
      .array(z.string())
      .describe("List of prompts to process"),
    model: z
      .string()
      .optional()
      .default("PrimeIntellect/INTELLECT-3"),
    system_prompt: z
      .string()
      .optional()
      .describe("System prompt applied to all"),
    temperature: z.number().optional().default(0.7),
  }),
  execute: async (params, ctx) => {
    const results: Array<{ prompt: string; response: string }> = [];
    
    for (const prompt of params.prompts) {
      const messages: ChatMessage[] = [];
      
      if (params.system_prompt) {
        messages.push({ role: "system", content: params.system_prompt });
      }
      messages.push({ role: "user", content: prompt });

      const body = {
        model: params.model,
        messages,
        temperature: params.temperature,
        stream: false,
      };

      try {
        const result = await piInferenceRequest<ChatCompletionResponse>(
          ctx.agent.vars as { PRIME_API_KEY?: string },
          "/chat/completions",
          { method: "POST", body: JSON.stringify(body) }
        );

        results.push({
          prompt,
          response: result.choices[0].message.content,
        });
      } catch (error) {
        results.push({
          prompt,
          response: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    return JSON.stringify({
      model: params.model,
      count: results.length,
      results,
    }, null, 2);
  },
  tags: ["prime", "prime-inference"],
});
