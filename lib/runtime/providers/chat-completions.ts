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

/**
 * Creates a provider for OpenAI-compatible chat completions APIs.
 * Works with OpenAI, OpenRouter, Azure OpenAI, and other compatible endpoints.
 */
export function makeChatCompletions(
  apiKey: string,
  baseUrl = "https://api.openai.com/v1"
): Provider {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`
  };

  return {
    async invoke(req, { signal }) {
      const body = toOA(req);
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, stream: false }),
        signal
      });
      if (!res.ok) {
        const errTxt = await res.text().catch(() => "");
        throw new Error(`Chat completions error ${res.status}: ${errTxt}`);
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
    },

    async stream(_req, _onDelta) {
      throw new Error("Streaming not implemented");
    }
  };
}
