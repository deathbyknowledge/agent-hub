/**
 * This creates a Durable Object class that needs to be exported, so wrangler can read it.
 * Make sure you add the binding `DEEP_AGENT` in your `wrangler.jsonc` file.
 */

import { getAgentByName } from "agents";
import { HubAgent } from "./agent";
import { Agency } from "./agency";
import { AgentEventType } from "./events";
import { makeOpenAI, type Provider } from "./providers";
import type {
  Tool,
  AgentPlugin,
  AgentBlueprint,
  AgentConfig,
  ThreadMetadata,
  AgentEnv
} from "./types";
import { createHandler, type HandlerOptions } from "./worker";

type AgentHubOptions = {
  defaultModel: string;
  provider?: Provider;
  handlerOptions?: HandlerOptions;
};

class ToolRegistry {
  private tools = new Map<string, Tool<any>>();
  private tags = new Map<string, string[]>();

  addTool<T>(name: string, tool: Tool<T>, tags?: string[]) {
    this.tools.set(name, tool);
    if (tags) {
      for (const tag of tags) {
        const existing = this.tags.get(tag) || [];
        existing.push(name);
        this.tags.set(tag, existing);
      }
    }
  }

  /**
   * Select tools by capabilities.
   * - `@tag` selects all tools with that tag
   * - `name` selects a specific tool by name
   */
  selectByCapabilities(capabilities: string[]): Tool<any>[] {
    const seen = new Set<string>();
    const selected: Tool<any>[] = [];

    for (const cap of capabilities) {
      if (cap.startsWith("@")) {
        // Tag: select all tools with this tag
        const tag = cap.slice(1);
        const toolNames = this.tags.get(tag) || [];
        for (const name of toolNames) {
          if (!seen.has(name)) {
            seen.add(name);
            const handler = this.tools.get(name);
            if (handler) selected.push(handler);
          }
        }
      } else {
        // Direct tool name
        if (!seen.has(cap)) {
          seen.add(cap);
          const handler = this.tools.get(cap);
          if (handler) {
            selected.push(handler);
          } else {
            console.warn(`Tool not found: ${cap}`);
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

export class AgentHub<TConfig = Record<string, unknown>> {
  toolRegistry = new ToolRegistry();
  pluginRegistry = new PluginRegistry();
  agentRegistry = new Map<string, AgentBlueprint>();
  config: Record<string, AgentConfig> = {};

  constructor(private options: AgentHubOptions) {}

  addTool<T>(tool: Tool<T>, tags?: string[]): AgentHub<TConfig> {
    this.toolRegistry.addTool(tool.meta.name, tool, tags);
    return this;
  }

  use<TNewConfig>(
    plugin: AgentPlugin<TNewConfig>,
    tags?: string[]
  ): AgentHub<TConfig & TNewConfig> {
    const uniqueTags = Array.from(new Set([...(tags || []), ...plugin.tags]));
    this.pluginRegistry.addPlugin(plugin.name, plugin, uniqueTags);
    return this as unknown as AgentHub<TConfig & TNewConfig>;
  }

  addAgent(blueprint: AgentBlueprint<Partial<TConfig>>): AgentHub<TConfig> {
    this.agentRegistry.set(blueprint.name, blueprint);
    return this;
  }

  export(): {
    HubAgent: typeof HubAgent<AgentEnv>;
    Agency: typeof Agency;
    handler: ReturnType<typeof createHandler>;
  } {
    const { toolRegistry, pluginRegistry, agentRegistry } = this;
    const options = this.options; // biome bug, if I put it above the biome things its not used anywhere
    class ConfiguredHubAgent extends HubAgent<AgentEnv> {
      async onDone(_ctx: { agent: HubAgent; final: string }): Promise<void> {
        // Override in subclass if needed
      }

      // Gets local agent blueprint or reads it from static defaults.
      // Local blueprint is set by Agency on registration.
      get blueprint(): AgentBlueprint {
        if (this.info.blueprint) return this.info.blueprint;
        if (!this.info.agentType) throw new Error("Agent type not set");

        const staticBp = agentRegistry.get(this.info.agentType);
        if (staticBp) return staticBp;

        throw new Error(`Agent type ${this.info.agentType} not found`);
      }

      async onRegister(meta: ThreadMetadata): Promise<void> {
        const type = meta.agentType;
        const agencyId = meta.agencyId; // <-- passed from Agency

        if (!agencyId) {
          throw new Error("Cannot register agent without Agency ID");
        }

        this.info.agencyId = agencyId;

        let bp: AgentBlueprint | undefined;

        // 1. Ask Agency DO for blueprint
        try {
          const agencyStub = await getAgentByName(this.env.AGENCY, agencyId);
          const res = await agencyStub.fetch(
            `http://do/internal/blueprint/${type}`
          );
          if (res.ok) {
            bp = await res.json<AgentBlueprint>();
          }
        } catch (e) {
          console.warn("Failed to fetch blueprint from Agency DO", e);
        }

        // 2. Fallback to static defaults from agentRegistry
        if (!bp) bp = agentRegistry.get(type);
        if (!bp) throw new Error(`Unknown agent type: ${type}`);

        // 3. Persist blueprint locally
        this.info.blueprint = bp;

          for (const p of this.plugins) {
          await p.onInit?.(this.pluginContext);
        }
      }

      get tools() {
        const blueprint = this.blueprint;
        const tools = toolRegistry.selectByCapabilities(blueprint.capabilities);
        return {
          ...Object.fromEntries(
            tools.map((t) => [t.meta.name, t] as const)
          ),
          ...this._tools
        };
      }

      get plugins() {
        const blueprint = this.blueprint;
        return pluginRegistry.selectByCapabilities(blueprint.capabilities);
      }

      get model() {
        return this.blueprint.model ?? options.defaultModel;
      }

      get systemPrompt(): string {
        return this.blueprint.prompt;
      }

      get config(): AgentConfig {
        return this.blueprint.config ?? { plugins: {}, tools: {} };
      }

      get provider(): Provider {
        let baseProvider = options?.provider;
        // Set OpenAI (chat completions really) provider if not set
        if (!baseProvider) {
          const apiKey = this.env.LLM_API_KEY;
          const apiBase = this.env.LLM_API_BASE;
          if (!apiKey)
            throw new Error("Neither LLM_API_KEY nor custom provider set");

          baseProvider = makeOpenAI(apiKey, apiBase);
        }

        return {
          invoke: async (req, opts) => {
            this.emit(AgentEventType.MODEL_STARTED, {
              model: req.model
            });
            const out = await baseProvider.invoke(req, opts);
            this.emit(AgentEventType.MODEL_COMPLETED, {
              usage: {
                inputTokens: out.usage?.promptTokens ?? 0,
                outputTokens: out.usage?.completionTokens ?? 0
              }
            });
            return out;
          },
          stream: async (req, onDelta) => {
            this.emit(AgentEventType.MODEL_STARTED, {
              model: req.model
            });
            const out = await baseProvider.stream(req, (d) => {
              this.emit(AgentEventType.MODEL_DELTA, { delta: d });
              onDelta(d);
            });
            this.emit(AgentEventType.MODEL_COMPLETED, {
              usage: undefined
            });
            return out;
          }
        };
      }
    }
    const handlerOptions = { ...options?.handlerOptions };
    if (!handlerOptions.agentDefinitions) {
      handlerOptions.agentDefinitions = Array.from(this.agentRegistry.values());
    }
    const handler = createHandler(handlerOptions);
    return { HubAgent: ConfiguredHubAgent, Agency, handler };
  }
}
