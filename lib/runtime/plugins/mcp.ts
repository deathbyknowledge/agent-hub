import type { AgentPlugin, VarHint, PluginContext } from "../types";

/**
 * MCP server configuration (passed from Agency via vars).
 * @deprecated MCP servers are now managed at the Agency level.
 * Agents use `mcp:*` capabilities to get MCP tools injected automatically.
 */
export type McpServerConfig = {
  id: string;
  name: string;
  url: string;
  status: string;
  authUrl?: string;
  error?: string;
};

/** MCP server info returned in state */
export type McpServerInfo = {
  id: string;
  name: string;
  url: string;
  status: string;
  authUrl?: string;
};

/** State tracked by the MCP plugin */
type McpPluginState = {
  servers: McpServerInfo[];
  toolCount: number;
};

/**
 * Get MCP servers from vars (passed from Agency).
 */
function getMcpServersFromVars(ctx: PluginContext): McpServerConfig[] {
  return (ctx.agent.vars.MCP_SERVERS as McpServerConfig[] | undefined) ?? [];
}

/**
 * Count MCP tools available to this agent.
 * MCP tools are injected by the hub based on blueprint capabilities.
 */
function countMcpTools(ctx: PluginContext): number {
  const tools = Object.keys(ctx.agent.tools);
  return tools.filter((name) => name.startsWith("mcp_")).length;
}

/**
 * Simplified MCP plugin for backward compatibility.
 * 
 * ## Important: MCP Architecture Change
 * MCP servers are now managed at the **Agency level**, not per-agent.
 * - The Agency holds the actual MCP connections
 * - Agents get MCP tools injected based on their blueprint capabilities
 * - Tool calls are proxied through the Agency
 * 
 * ## How to use MCP tools
 * Add MCP capabilities to your blueprint:
 * ```ts
 * capabilities: [
 *   "planning",
 *   "mcp:*",           // All MCP tools from all servers
 *   "mcp:github",      // All tools from the 'github' server
 *   "mcp:slack:chat",  // Specific tool from a specific server
 * ]
 * ```
 * 
 * ## Managing MCP servers
 * Configure MCP servers via the Agency Settings UI or API:
 * - POST /agency/:id/mcp - Add server
 * - DELETE /agency/:id/mcp/:serverId - Remove server
 * - GET /agency/:id/mcp - List servers
 * 
 * ## Plugin functionality
 * This plugin now only provides:
 * - State exposure (list of configured servers, tool count)
 * - The `mcp.list` action for querying MCP status
 * 
 * @deprecated Direct MCP management via this plugin is deprecated.
 *             Use Agency-level MCP management instead.
 */
export const mcp: AgentPlugin = {
  name: "mcp",

  varHints: [
    {
      name: "MCP_SERVERS",
      required: false,
      description: "MCP server configs (auto-populated by Agency). Do not set manually.",
    },
  ] as VarHint[],

  actions: {
    /** List MCP servers and tools available to this agent */
    async "mcp.list"(ctx) {
      const servers = getMcpServersFromVars(ctx);
      const toolCount = countMcpTools(ctx);
      
      // Get injected MCP tools
      const mcpTools = Object.entries(ctx.agent.tools)
        .filter(([name]) => name.startsWith("mcp_"))
        .map(([name, tool]) => ({
          name,
          description: tool.meta.description,
        }));

      return {
        servers: servers.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          status: s.status,
          authUrl: s.authUrl,
        })),
        tools: mcpTools,
        toolCount,
      };
    },
  },

  state(ctx) {
    const servers = getMcpServersFromVars(ctx);
    const toolCount = countMcpTools(ctx);

    return {
      mcp: {
        servers: servers.map((s) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          status: s.status,
          authUrl: s.authUrl,
        })),
        toolCount,
      } as McpPluginState,
    };
  },

  tags: ["mcp"],
};
