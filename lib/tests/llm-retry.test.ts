import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeChatCompletions } from "../runtime/providers/chat-completions";

describe("LLM provider retries", () => {
  const req = {
    model: "test-model",
    messages: [{ role: "user" as const, content: "Hello" }],
  };

  const okResponse = new Response(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );

  const retryOptions = {
    maxRetries: 1,
    backoffMs: 0,
    maxBackoffMs: 0,
    jitterRatio: 0,
    retryableStatusCodes: [520],
  };

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries when the response status is retryable", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response("temporary", { status: 520, headers: { "Retry-After": "0" } })
      )
      .mockResolvedValueOnce(okResponse);

    const provider = makeChatCompletions("test-key", "https://example.test/v1", {
      retry: retryOptions,
    });

    const result = await provider.invoke(req, {});
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    if ("content" in result.message) {
      expect(result.message.content).toBe("ok");
    }
  });

  it("does not retry when the status is not retryable", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("bad", { status: 400 }));

    const provider = makeChatCompletions("test-key", "https://example.test/v1", {
      retry: retryOptions,
    });

    await expect(provider.invoke(req, {})).rejects.toThrow(
      "Chat completions error 400"
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
