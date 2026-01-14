import type { ChatMessage, ModelRequest } from "../types";
import { type Provider, parseModel } from ".";

type OAChatMsg =
  | {
      role: "system" | "user" | "assistant" | "tool";
      content: string;
      name?: string;
      tool_call_id?: string;
      reasoning?: string;
    }
  | {
      role: "assistant";
      content?: string;
      reasoning?: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };

export type ChatCompletionsRetryOptions = {
  maxRetries: number;
  backoffMs: number;
  maxBackoffMs: number;
  jitterRatio: number;
  retryableStatusCodes: number[];
};

export type ChatCompletionsOptions = {
  retry?: ChatCompletionsRetryOptions;
};

function toOA(req: ModelRequest) {
  const msgs: OAChatMsg[] = [];
  if (req.systemPrompt)
    msgs.push({ role: "system", content: req.systemPrompt });

  for (const m of req.messages) {
    if (m.role === "tool") {
      msgs.push({
        role: "tool",
        content: m.content ?? "",
        tool_call_id: m.toolCallId
      });
    } else if (
      m.role === "assistant" &&
      "toolCalls" in m &&
      m.toolCalls?.length
    ) {
      msgs.push({
        role: "assistant",
        content: "",
        tool_calls: m.toolCalls.map(({ id, name, args }) => ({
          id,
          type: "function",
          function: {
            name,
            arguments: typeof args === "string" ? args : JSON.stringify(args ?? {})
          }
        }))
      });
    } else if ("content" in m) {
      msgs.push({ role: m.role, content: m.content ?? "" });
    }
  }

  const tools = (req.toolDefs ?? []).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? undefined,
      parameters: t.parameters ?? {
        type: "object",
        properties: {},
        additionalProperties: true
      }
    }
  }));

  return {
    model: parseModel(req.model),
    messages: msgs,
    temperature: req.temperature,
    max_tokens: req.maxTokens,
    stop: req.stop,
    tools,
    tool_choice: req.toolChoice ?? "auto"
  };
}

function safeParseJSON(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function fromOA(choice: { message: OAChatMsg }): ChatMessage {
  const msg = choice?.message ?? {};
  if ("tool_calls" in msg && msg?.tool_calls?.length) {
    return {
      role: "assistant",
      reasoning: msg.reasoning,
      toolCalls: msg.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function?.name,
        args: safeParseJSON(tc.function?.arguments ?? "{}")
      }))
    };
  }
  return { role: "assistant", reasoning: msg?.reasoning, content: msg?.content ?? "" };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abortError = new Error("Request aborted");
    abortError.name = "AbortError";

    if (signal?.aborted) {
      clearTimeout(timer);
      return reject(abortError);
    }

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(abortError);
        },
        { once: true }
      );
    }
  });
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

function computeDelayMs(
  attempt: number,
  retry: ChatCompletionsRetryOptions,
  retryAfterMs: number | null
): number {
  let delay =
    retryAfterMs ??
    Math.min(retry.maxBackoffMs, retry.backoffMs * 2 ** attempt);
  if (retry.jitterRatio > 0) {
    const jitter = delay * retry.jitterRatio;
    delay += (Math.random() * 2 - 1) * jitter;
  }
  return Math.max(0, Math.round(delay));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

class NonRetryableError extends Error {
  readonly retryable = false;
}

/**
 * Creates a provider for OpenAI-compatible chat completions APIs.
 * Works with OpenAI, OpenRouter, Azure OpenAI, and other compatible endpoints.
 */
export function makeChatCompletions(
  apiKey: string,
  baseUrl = "https://api.openai.com/v1",
  options: ChatCompletionsOptions = {}
): Provider {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`
  };
  const retry = options.retry && options.retry.maxRetries > 0 ? options.retry : null;

  return {
    async invoke(req, { signal }) {
      const body = toOA(req);
      const payload = JSON.stringify({ ...body, stream: false });
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers,
            body: payload,
            signal
          });

          if (!res.ok) {
            const retryAfterMs = parseRetryAfterMs(
              res.headers.get("Retry-After")
            );
            if (
              retry &&
              retry.retryableStatusCodes.includes(res.status) &&
              attempt < retry.maxRetries
            ) {
              await sleep(computeDelayMs(attempt, retry, retryAfterMs), signal);
              continue;
            }

            const errTxt = await res.text().catch(() => "");
            throw new NonRetryableError(
              `Chat completions error ${res.status}: ${errTxt}`
            );
          }

          const json = (await res.json()) as {
            choices: Array<{ message: OAChatMsg }>;
            usage: { prompt_tokens: number; completion_tokens: number };
          };
          const message = fromOA(json.choices?.[0]);
          const usage = json.usage
            ? {
                promptTokens: json.usage.prompt_tokens,
                completionTokens: json.usage.completion_tokens
              }
            : undefined;
          return { message, usage };
        } catch (error) {
          if (signal?.aborted || isAbortError(error)) {
            throw error;
          }

          if (
            retry &&
            attempt < retry.maxRetries &&
            !(error instanceof NonRetryableError)
          ) {
            await sleep(computeDelayMs(attempt, retry, null), signal);
            continue;
          }

          throw error;
        }
      }
    },

    async stream(_req, _onDelta) {
      throw new Error("Streaming not implemented");
    }
  };
}
