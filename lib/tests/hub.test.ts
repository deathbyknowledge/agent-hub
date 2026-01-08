import { describe, expect, it } from "vitest";
import { filterMcpToolsByCapabilities, type McpToolInfo } from "../runtime/hub";

describe("filterMcpToolsByCapabilities", () => {
  const tools: McpToolInfo[] = [
    { serverId: "abc123", serverName: "GitHub", name: "create_issue", description: "Create an issue" },
    { serverId: "abc123", serverName: "GitHub", name: "list_repos", description: "List repos" },
    { serverId: "def456", serverName: "Slack", name: "send_message", description: "Send a message" },
    { serverId: "def456", serverName: "Slack", name: "list_channels", description: "List channels" },
    { serverId: "ghi789", serverName: "Linear", name: "create_issue", description: "Create Linear issue" },
  ];

  it("should return empty array when no mcp capabilities", () => {
    const result = filterMcpToolsByCapabilities(tools, ["@default", "planning"]);
    expect(result).toEqual([]);
  });

  it("should return all tools with mcp:*", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:*"]);
    expect(result).toHaveLength(5);
  });

  it("should filter by server ID", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:abc123"]);
    expect(result).toHaveLength(2);
    expect(result.every(t => t.serverId === "abc123")).toBe(true);
  });

  it("should filter by server name", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:GitHub"]);
    expect(result).toHaveLength(2);
    expect(result.every(t => t.serverName === "GitHub")).toBe(true);
  });

  it("should filter specific tool by server ID and tool name", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:abc123:create_issue"]);
    expect(result).toHaveLength(1);
    expect(result[0].serverId).toBe("abc123");
    expect(result[0].name).toBe("create_issue");
  });

  it("should filter specific tool by server name and tool name", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:Slack:send_message"]);
    expect(result).toHaveLength(1);
    expect(result[0].serverName).toBe("Slack");
    expect(result[0].name).toBe("send_message");
  });

  it("should combine multiple mcp capabilities", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:GitHub", "mcp:Linear"]);
    expect(result).toHaveLength(3);
    const serverNames = result.map(t => t.serverName);
    expect(serverNames).toContain("GitHub");
    expect(serverNames).toContain("Linear");
  });

  it("should deduplicate when capabilities overlap", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:*", "mcp:GitHub"]);
    expect(result).toHaveLength(5); // Should not have duplicates
  });

  it("should handle tool names with colons", () => {
    const toolsWithColons: McpToolInfo[] = [
      { serverId: "srv1", serverName: "Server", name: "ns:action:sub", description: "Namespaced tool" },
    ];
    const result = filterMcpToolsByCapabilities(toolsWithColons, ["mcp:Server:ns:action:sub"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ns:action:sub");
  });

  it("should return empty when server not found", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:NonExistent"]);
    expect(result).toEqual([]);
  });

  it("should return empty when tool not found", () => {
    const result = filterMcpToolsByCapabilities(tools, ["mcp:GitHub:nonexistent_tool"]);
    expect(result).toEqual([]);
  });
});
