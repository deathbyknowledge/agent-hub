import { getAgentByName } from "agents";
import { HubAgent } from "./agent";
import { Agency, type McpToolCallRequest, type McpToolCallResponse } from "./agency";
import { AgentEventType } from "./events";
import { makeChatCompletions, type Provider } from "./providers";
import {
  DEFAULT_LLM_RETRY_BACKOFF_MS,
  DEFAULT_LLM_RETRY_JITTER_RATIO,
  DEFAULT_LLM_RETRY_MAX,
  DEFAULT_LLM_RETRY_MAX_BACKOFF_MS,
  DEFAULT_LLM_RETRY_STATUS_CODES,
  DEFAULT_LLM_API_BASE,
} from "./config";
import type {
  Tool,
  AgentPlugin,
  AgentBlueprint,
  ThreadMetadata,
  AgentEnv,
  ToolContext,
} from "./types";
import { createHandler, type HandlerOptions } from "./worker";

function readNumberVar(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && Number.isFinite(Number(trimmed))) {
      return Number(trimmed);
    }
  }
  return fallback;
}

function readStatusCodesVar(
  value: unknown,
  fallback: number[]
): number[] {
  if (Array.isArray(value)) {
    const codes = value
      .map((v) => readNumberVar(v, NaN))
      .filter((v) => Number.isFinite(v));
    if (codes.length > 0) return codes;
  }
  if (typeof value === "string") {
    const codes = value
      .split(",")
      .map((v) => readNumberVar(v, NaN))
      .filter((v) => Number.isFinite(v));
    if (codes.length > 0) return codes;
  }
  return fallback;
}

// MCP tool info from Agency (enriched with serverName for capability matching)
export interface McpToolInfo {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Create a proxy tool that calls an MCP tool via the Agency.
 * The Agency holds the actual MCP connection and handles the call.
 */
function createMcpProxyTool(toolInfo: McpToolInfo, agencyId: string): Tool<Record<string, unknown>> {
  // Prefix tool name with server ID to avoid collisions
  const toolName = `mcp_${toolInfo.serverId}_${toolInfo.name}`;
  
  return {
    meta: {
      name: toolName,
      description: toolInfo.description || `MCP tool: ${toolInfo.name} (server: ${toolInfo.serverId})`,
      parameters: toolInfo.inputSchema || { type: "object", properties: {} },
    },
    tags: ["mcp", `mcp:${toolInfo.serverId}`],
    execute: async (args: Record<string, unknown>, ctx: ToolContext) => {
      const agencyStub = await getAgentByName(ctx.agent.exports.Agency, agencyId);
      
      const request: McpToolCallRequest = {
        serverId: toolInfo.serverId,
        toolName: toolInfo.name,
        arguments: args,
      };
      
      const res = await agencyStub.fetch(
        new Request("http://do/mcp/call", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        })
      );
      
      if (!res.ok) {
        const errorText = await res.text();
        // TODO: Add retry logic for transient failures
        throw new Error(`MCP tool call failed: ${errorText}`);
      }
      
      const result = await res.json<McpToolCallResponse>();
      
      if (result.isError) {
        const errorContent = result.content?.find(c => c.type === "text");
        throw new Error(errorContent?.text || "MCP tool returned an error");
      }
      
      // Format the result for the model
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
      
      return "Tool completed with no output";
    },
  };
}

/**
 * Filter MCP tools based on capability patterns.
 * Patterns:
 *   - "mcp:*" → all MCP tools from all servers
 *   - "mcp:server" → all tools from a specific server (by ID or name)
 *   - "mcp:server:toolname" → specific tool from a server (by ID or name)
 */
export function filterMcpToolsByCapabilities(
  tools: McpToolInfo[],
  capabilities: string[]
): McpToolInfo[] {
  const mcpCaps = capabilities.filter(c => c.startsWith("mcp:"));
  if (mcpCaps.length === 0) return [];
  
  const selected: McpToolInfo[] = [];
  const seen = new Set<string>();
  
  for (const cap of mcpCaps) {
    const parts = cap.split(":");
    
    if (parts[1] === "*") {
      // mcp:* → all tools
      for (const tool of tools) {
        const key = `${tool.serverId}:${tool.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          selected.push(tool);
        }
      }
    } else if (parts.length === 2) {
      // mcp:server → all tools from that server (matches ID or name)
      const serverIdOrName = parts[1];
      for (const tool of tools) {
        if (tool.serverId === serverIdOrName || tool.serverName === serverIdOrName) {
          const key = `${tool.serverId}:${tool.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            selected.push(tool);
          }
        }
      }
    } else if (parts.length >= 3) {
      // mcp:server:toolname → specific tool (matches ID or name)
      const serverIdOrName = parts[1];
      const toolName = parts.slice(2).join(":"); // Handle colons in tool name
      for (const tool of tools) {
        if ((tool.serverId === serverIdOrName || tool.serverName === serverIdOrName) && tool.name === toolName) {
          const key = `${tool.serverId}:${tool.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            selected.push(tool);
          }
        }
      }
    }
  }
  
  return selected;
}



type AgentHubOptions = {
  defaultModel?: string;
  provider?: Provider;
};

class ToolRegistry {
  private tools = new Map<string, Tool<any>>();
  private tags = new Map<string, string[]>();
  private toolTags = new Map<string, string[]>();

  addTool<T>(name: string, tool: Tool<T>, tags?: string[]) {
    this.tools.set(name, tool);
    // Merge intrinsic tags from tool definition with provided tags
    const intrinsicTags = tool.tags ?? [];
    const allTags = [...new Set([...intrinsicTags, ...(tags ?? [])])];
    if (allTags.length > 0) {
      this.toolTags.set(name, allTags);
      for (const tag of allTags) {
        const existing = this.tags.get(tag) || [];
        existing.push(name);
        this.tags.set(tag, existing);
      }
    }
  }

  getAll(): Array<{
    name: string;
    description?: string;
    tags: string[];
    varHints?: Tool<any>["varHints"];
  }> {
    const result: Array<{
      name: string;
      description?: string;
      tags: string[];
      varHints?: Tool<any>["varHints"];
    }> = [];
    for (const [name, tool] of this.tools) {
      result.push({
        name,
        description: tool.meta.description,
        tags: this.toolTags.get(name) ?? [],
        varHints: tool.varHints?.length ? tool.varHints : undefined,
      });
    }
    return result;
  }

  selectByCapabilities(capabilities: string[]): Tool<any>[] {
    const seen = new Set<string>();
    const selected: Tool<any>[] = [];

    for (const cap of capabilities) {
      if (cap.startsWith("@")) {
        // Tags are stored WITH the @ prefix, so look up directly
        const toolNames = this.tags.get(cap) || [];
        for (const name of toolNames) {
          if (!seen.has(name)) {
            seen.add(name);
            const handler = this.tools.get(name);
            if (handler) selected.push(handler);
          }
        }
      } else {
        if (!seen.has(cap)) {
          seen.add(cap);
          const handler = this.tools.get(cap);
          if (handler) {
            selected.push(handler);
          }
        }
      }
    }

    return selected;
  }
}

class PluginRegistry {
  private plugins = new Map<string, AgentPlugin>();
  private tags = new Map<string, string[]>();

  addPlugin(name: string, handler: AgentPlugin, tags?: string[]) {
    this.plugins.set(name, handler);
    if (tags) {
      for (const tag of tags) {
        const existing = this.tags.get(tag) || [];
        existing.push(name);
        this.tags.set(tag, existing);
      }
    }
  }

  getAll(): Array<{
    name: string;
    tags: string[];
    varHints?: AgentPlugin["varHints"];
  }> {
    const result: Array<{
      name: string;
      tags: string[];
      varHints?: AgentPlugin["varHints"];
    }> = [];
    for (const [name, plugin] of this.plugins) {
      result.push({
        name,
        tags: plugin.tags,
        varHints: plugin.varHints?.length ? plugin.varHints : undefined,
      });
    }
    return result;
  }

  selectByCapabilities(capabilities: string[]): AgentPlugin[] {
    const seen = new Set<string>();
    const selected: AgentPlugin[] = [];

    for (const cap of capabilities) {
      if (cap.startsWith("@")) {
        const tag = cap.slice(1);
        const pluginNames = this.tags.get(tag) || [];
        for (const name of pluginNames) {
          if (!seen.has(name)) {
            seen.add(name);
            const handler = this.plugins.get(name);
            if (handler) selected.push(handler);
          }
        }
      } else {
        if (!seen.has(cap)) {
          seen.add(cap);
          const handler = this.plugins.get(cap);
          if (handler) {
            selected.push(handler);
          }
        }
      }
    }

    return selected;
  }
}

/**
 * Main entry point for configuring an AgentHub instance.
 * Register tools, plugins, and agent blueprints, then call `export()` to
 * get the Durable Object classes and HTTP handler for your Worker.
 *
 * @example
 * ```ts
 * const hub = new AgentHub({ defaultModel: "gpt-4o" })
 *   .addTool(myTool, ["@default"])
 *   .use(myPlugin)
 *   .addAgent({ name: "assistant", ... });
 *
 * export const { HubAgent, Agency, handler } = hub.export();
 * export default { fetch: handler };
 * ```
 */
export class AgentHub {
  toolRegistry = new ToolRegistry();
  pluginRegistry = new PluginRegistry();
  agentRegistry = new Map<string, AgentBlueprint>();
  defaultVars: Record<string, unknown> = {};

  constructor(private options: AgentHubOptions) {}

  /** Register a tool with optional tags for capability-based selection. */
  addTool<T>(tool: Tool<T>, tags?: string[]): AgentHub {
    this.toolRegistry.addTool(tool.meta.name, tool, tags);
    return this;
  }

  /** Register a plugin with optional additional tags. */
  use(plugin: AgentPlugin, tags?: string[]): AgentHub {
    const uniqueTags = Array.from(new Set([...(tags || []), ...plugin.tags]));
    this.pluginRegistry.addPlugin(plugin.name, plugin, uniqueTags);
    return this;
  }

  /** Register a static agent blueprint. */
  addAgent(blueprint: AgentBlueprint): AgentHub {
    this.agentRegistry.set(blueprint.name, blueprint);
    return this;
  }

  /** Export the configured Durable Object classes and HTTP handler. */
  export(): {
    HubAgent: typeof HubAgent<AgentEnv>;
    Agency: typeof Agency;
    handler: ReturnType<typeof createHandler>;
  } {
    const options = this.options;
    const { toolRegistry, pluginRegistry, agentRegistry } = this;
    class ConfiguredHubAgent extends HubAgent<AgentEnv> {
      get blueprint(): AgentBlueprint {
        if (this.info.blueprint) return this.info.blueprint;
        if (!this.info.agentType) throw new Error("Agent type not set");

        const staticBp = agentRegistry.get(this.info.agentType);
        if (staticBp) return staticBp;

        throw new Error(`Agent type ${this.info.agentType} not found`);
      }

      getStaticBlueprints(): AgentBlueprint[] {
        return Array.from(agentRegistry.values());
      }

      getRegisteredPlugins(): Array<{
        name: string;
        tags: string[];
        varHints?: Array<{ name: string; required?: boolean; description?: string }>;
      }> {
        return pluginRegistry.getAll();
      }

      getRegisteredTools(): Array<{
        name: string;
        description?: string;
        tags: string[];
        varHints?: Array<{ name: string; required?: boolean; description?: string }>;
      }> {
        return toolRegistry.getAll();
      }

      async onRegister(meta: ThreadMetadata): Promise<void> {
        const type = meta.agentType;
        const agencyId = meta.agencyId;

        if (!agencyId) {
          throw new Error("Cannot register agent without Agency ID");
        }

        this.info.agencyId = agencyId;
        if (options.defaultModel && !this.vars.DEFAULT_MODEL) {
          this.vars.DEFAULT_MODEL = options.defaultModel;
        }

        let bp: AgentBlueprint | undefined;
        const agencyStub = await getAgentByName(
          this.exports.Agency,
          agencyId
        );

        try {
          const res = await agencyStub.fetch(
            `http://do/internal/blueprint/${type}`
          );
          if (res.ok) {
            bp = await res.json<AgentBlueprint>();
          }
        } catch (e) {
          console.warn("Failed to fetch blueprint from Agency DO", e);
        }

        if (!bp) bp = agentRegistry.get(type);
        if (!bp) throw new Error(`Unknown agent type: ${type}`);

        this.info.blueprint = bp;

        if (bp.vars) {
          Object.assign(this.vars, bp.vars);
        }

        for (const p of this.plugins) {
          await p.onInit?.(this.pluginContext);
        }
      }

      /**
       * Refresh MCP tools from the Agency.
       * Called before each model invocation to ensure tools are available
       * even after agent eviction/restart.
       */
      async refreshMcpTools(): Promise<void> {
        const agencyId = this.info.agencyId;
        if (!agencyId) return;

        const blueprint = this.blueprint;
        const hasMcpCaps = blueprint.capabilities.some(c => c.startsWith("mcp:"));
        if (!hasMcpCaps) return;

        try {
          const agencyStub = await getAgentByName(this.exports.Agency, agencyId);
          const mcpToolsRes = await agencyStub.fetch("http://do/mcp/tools");
          
          if (!mcpToolsRes.ok) {
            console.warn("[MCP] Failed to fetch tools:", mcpToolsRes.status);
            return;
          }
          
          const { tools: mcpTools } = await mcpToolsRes.json<{ tools: McpToolInfo[] }>();
          const filteredTools = filterMcpToolsByCapabilities(mcpTools, blueprint.capabilities);
          
          // Clear old MCP tools
          for (const key of Object.keys(this._tools)) {
            if (key.startsWith("mcp_")) {
              delete this._tools[key];
            }
          }
          
          // Register new MCP tools
          for (const toolInfo of filteredTools) {
            const proxyTool = createMcpProxyTool(toolInfo, agencyId);
            this._tools[proxyTool.meta.name] = proxyTool;
          }
        } catch (e) {
          console.warn("[MCP] Failed to refresh tools:", e);
        }
      }

      get tools() {
        const blueprint = this.blueprint;
        const tools = toolRegistry.selectByCapabilities(blueprint.capabilities);
        return {
          ...Object.fromEntries(tools.map((t) => [t.meta.name, t] as const)),
          ...this._tools,
        };
      }

      get plugins() {
        const blueprint = this.blueprint;
        const basePlugins = pluginRegistry.selectByCapabilities(blueprint.capabilities);
        
        // Add internal MCP injector plugin if blueprint has MCP capabilities
        const hasMcpCaps = blueprint.capabilities.some(c => c.startsWith("mcp:"));
        if (hasMcpCaps) {
          const mcpInjectorPlugin: AgentPlugin = {
            name: "_mcp-injector",
            tags: [],
            beforeModel: async () => {
              await this.refreshMcpTools();
            },
          };
          return [mcpInjectorPlugin, ...basePlugins];
        }
        
        return basePlugins;
      }

      get provider(): Provider {
        let baseProvider = options?.provider;
        if (!baseProvider) {
          const apiKey =
            (this.vars.LLM_API_KEY as string) ?? this.env.LLM_API_KEY;
          const apiBase =
            (this.vars.LLM_API_BASE as string) ??
            this.env.LLM_API_BASE ??
            DEFAULT_LLM_API_BASE;
          if (!apiKey)
            throw new Error("Neither LLM_API_KEY nor custom provider set");

          const retry = {
            maxRetries: readNumberVar(
              this.vars.LLM_RETRY_MAX ?? this.env.LLM_RETRY_MAX,
              DEFAULT_LLM_RETRY_MAX
            ),
            backoffMs: readNumberVar(
              this.vars.LLM_RETRY_BACKOFF_MS ?? this.env.LLM_RETRY_BACKOFF_MS,
              DEFAULT_LLM_RETRY_BACKOFF_MS
            ),
            maxBackoffMs: readNumberVar(
              this.vars.LLM_RETRY_MAX_BACKOFF_MS ??
                this.env.LLM_RETRY_MAX_BACKOFF_MS,
              DEFAULT_LLM_RETRY_MAX_BACKOFF_MS
            ),
            jitterRatio: readNumberVar(
              this.vars.LLM_RETRY_JITTER_RATIO ??
                this.env.LLM_RETRY_JITTER_RATIO,
              DEFAULT_LLM_RETRY_JITTER_RATIO
            ),
            retryableStatusCodes: readStatusCodesVar(
              this.vars.LLM_RETRY_STATUS_CODES ??
                this.env.LLM_RETRY_STATUS_CODES,
              DEFAULT_LLM_RETRY_STATUS_CODES
            ),
          };

          baseProvider = makeChatCompletions(apiKey, apiBase, { retry });
        }

        return {
          invoke: async (req, opts) => {
            this.emit(AgentEventType.CHAT_START, {
              "gen_ai.request.model": req.model,
            });
            const out = await baseProvider.invoke(req, opts);
            this.emit(AgentEventType.CHAT_FINISH, {
              "gen_ai.usage.input_tokens": out.usage?.promptTokens ?? 0,
              "gen_ai.usage.output_tokens": out.usage?.completionTokens ?? 0,
            });
            return out;
          },
          stream: async (req, onDelta) => {
            this.emit(AgentEventType.CHAT_START, {
              "gen_ai.request.model": req.model,
            });
            const out = await baseProvider.stream(req, (d) => {
              this.emit(AgentEventType.CHAT_CHUNK, { "gen_ai.content.chunk": d });
              onDelta(d);
            });
            this.emit(AgentEventType.CHAT_FINISH, {
              "gen_ai.usage.input_tokens": undefined,
              "gen_ai.usage.output_tokens": undefined,
            });
            return out;
          },
        };
      }
    }

    const handlerOptions: HandlerOptions = {};
    handlerOptions.agentDefinitions = Array.from(this.agentRegistry.values());
    handlerOptions.plugins = pluginRegistry.getAll();
    handlerOptions.tools = toolRegistry.getAll();
    const handler = createHandler(handlerOptions);
    return { HubAgent: ConfiguredHubAgent, Agency, handler };
  }
}
