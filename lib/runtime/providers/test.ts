import type { Provider, ModelResult } from "./index";
import type { ModelRequest, ChatMessage, ToolCall } from "../types";

/**
 * A response that the TestProvider should return.
 * Can be a simple text response, a tool call, or a full ChatMessage.
 */
export type MockResponse =
  | string // Simple text response
  | { toolCalls: ToolCall[] } // Tool call response
  | { message: ChatMessage; usage?: ModelResult["usage"] }; // Full response

/**
 * Configuration for expected tool calls.
 * Used to validate that the agent makes the expected tool calls.
 */
export interface ToolCallExpectation {
  name: string;
  args?: Record<string, unknown> | ((args: unknown) => boolean);
}

/**
 * TestProvider gives tests full control over LLM responses.
 *
 * Features:
 * - Queue responses to return in order
 * - Record all requests made to the provider
 * - Set expectations for tool calls
 * - Provide dynamic response handlers
 *
 * @example
 * ```ts
 * const provider = new TestProvider();
 *
 * // Queue simple text responses
 * provider.addResponse("Hello!");
 * provider.addResponse("How can I help?");
 *
 * // Queue a tool call
 * provider.addResponse({
 *   toolCalls: [{
 *     id: "call_1",
 *     name: "search",
 *     args: { query: "test" }
 *   }]
 * });
 *
 * // After running the agent, check requests
 * expect(provider.requests).toHaveLength(2);
 * expect(provider.requests[0].messages).toContainEqual({ role: "user", content: "Hi" });
 * ```
 */
export class TestProvider implements Provider {
  /** All requests made to this provider */
  readonly requests: ModelRequest[] = [];

  /** Queued responses to return */
  private responses: MockResponse[] = [];

  /** Dynamic response handler (used if no queued responses) */
  private responseHandler?: (req: ModelRequest) => MockResponse;

  /** Tool call expectations for validation */
  private toolCallExpectations: ToolCallExpectation[] = [];

  /** Recorded tool calls for assertions */
  readonly toolCalls: ToolCall[] = [];

  /**
   * Add a response to the queue.
   * Responses are returned in FIFO order.
   */
  addResponse(response: MockResponse): this {
    this.responses.push(response);
    return this;
  }

  /**
   * Add multiple responses to the queue.
   */
  addResponses(...responses: MockResponse[]): this {
    this.responses.push(...responses);
    return this;
  }

  /**
   * Set a dynamic response handler.
   * Called when the response queue is empty.
   */
  onRequest(handler: (req: ModelRequest) => MockResponse): this {
    this.responseHandler = handler;
    return this;
  }

  /**
   * Set expected tool calls for validation.
   * Call `assertExpectations()` to verify they were made.
   */
  expectToolCalls(...expectations: ToolCallExpectation[]): this {
    this.toolCallExpectations.push(...expectations);
    return this;
  }

  /**
   * Assert that all expected tool calls were made.
   * Throws if expectations weren't met.
   */
  assertExpectations(): void {
    for (const expectation of this.toolCallExpectations) {
      const found = this.toolCalls.find((tc) => {
        if (tc.name !== expectation.name) return false;
        if (!expectation.args) return true;

        if (typeof expectation.args === "function") {
          return expectation.args(tc.args);
        }

        // Deep equality check for expected args
        const tcArgs = tc.args as Record<string, unknown>;
        for (const [key, value] of Object.entries(expectation.args)) {
          if (JSON.stringify(tcArgs[key]) !== JSON.stringify(value)) {
            return false;
          }
        }
        return true;
      });

      if (!found) {
        const argsDesc =
          expectation.args && typeof expectation.args !== "function"
            ? ` with args ${JSON.stringify(expectation.args)}`
            : "";
        throw new Error(
          `Expected tool call "${expectation.name}"${argsDesc} was not made. ` +
            `Actual tool calls: ${JSON.stringify(this.toolCalls.map((tc) => tc.name))}`
        );
      }
    }
  }

  /**
   * Reset the provider state.
   * Clears requests, responses, and expectations.
   */
  reset(): this {
    this.requests.length = 0;
    this.responses.length = 0;
    this.toolCalls.length = 0;
    this.toolCallExpectations.length = 0;
    this.responseHandler = undefined;
    return this;
  }

  /**
   * Get the next response from the queue or handler.
   */
  private getNextResponse(req: ModelRequest): MockResponse {
    if (this.responses.length > 0) {
      return this.responses.shift()!;
    }

    if (this.responseHandler) {
      return this.responseHandler(req);
    }

    throw new Error(
      "TestProvider: No response queued and no handler set. " +
        `Request had ${req.messages.length} messages. ` +
        "Call addResponse() or onRequest() to provide responses."
    );
  }

  /**
   * Convert a MockResponse to a ModelResult.
   */
  private toResult(response: MockResponse): ModelResult {
    // Full response object
    if (typeof response === "object" && "message" in response) {
      // Record any tool calls from assistant messages
      const msg = response.message;
      if (msg.role === "assistant" && "toolCalls" in msg) {
        this.toolCalls.push(...msg.toolCalls);
      }
      return response;
    }

    // Tool call response
    if (typeof response === "object" && "toolCalls" in response) {
      this.toolCalls.push(...response.toolCalls);
      return {
        message: {
          role: "assistant",
          toolCalls: response.toolCalls,
        },
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    // Simple text response
    return {
      message: {
        role: "assistant",
        content: response,
      },
      usage: { promptTokens: 0, completionTokens: 0 },
    };
  }

  async invoke(
    req: ModelRequest,
    _opts: { signal?: AbortSignal }
  ): Promise<ModelResult> {
    this.requests.push(structuredClone(req));
    const response = this.getNextResponse(req);
    return this.toResult(response);
  }

  async stream(
    req: ModelRequest,
    onDelta: (chunk: string) => void
  ): Promise<ModelResult> {
    this.requests.push(structuredClone(req));
    const response = this.getNextResponse(req);
    const result = this.toResult(response);

    // Simulate streaming by emitting the content in chunks
    const msg = result.message;
    if (msg.role === "assistant" && "content" in msg) {
      const content = msg.content;
      const chunkSize = 10;
      for (let i = 0; i < content.length; i += chunkSize) {
        onDelta(content.slice(i, i + chunkSize));
      }
    }

    return result;
  }
}

/**
 * Create a simple test provider with predefined responses.
 *
 * @example
 * ```ts
 * const provider = createTestProvider("Hello!", "How can I help?");
 * ```
 */
export function createTestProvider(...responses: MockResponse[]): TestProvider {
  const provider = new TestProvider();
  provider.addResponses(...responses);
  return provider;
}

/**
 * Create a test provider that echoes user messages.
 * Useful for simple interaction tests.
 */
export function createEchoProvider(): TestProvider {
  const provider = new TestProvider();
  provider.onRequest((req) => {
    const lastUserMsg = [...req.messages]
      .reverse()
      .find((m) => m.role === "user");
    const content = lastUserMsg && "content" in lastUserMsg ? lastUserMsg.content : "(no message)";
    return `Echo: ${content}`;
  });
  return provider;
}

/**
 * Create a test provider that always calls a specific tool.
 *
 * @example
 * ```ts
 * const provider = createToolCallProvider("search", { query: "test" });
 * ```
 */
export function createToolCallProvider(
  toolName: string,
  args: unknown = {},
  callId = "call_1"
): TestProvider {
  const provider = new TestProvider();
  provider.addResponse({
    toolCalls: [{ id: callId, name: toolName, args }],
  });
  return provider;
}
