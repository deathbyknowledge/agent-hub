import { tool } from "agents-hub";
import * as z from "zod";

export const internetSearchTool = tool({
  name: "internet_search",
  description: "Search the internet for information",
  inputSchema: z.object({
    query: z.string().describe("The query to search for"),
  }),
  varHints: [
    { name: "TAVILY_API_KEY", required: true, description: "API key for Tavily internet search" },
  ],
  execute: async ({ query }, ctx) => {
    const apiKey = ctx.agent.vars.TAVILY_API_KEY;
    if (!apiKey) throw new Error("Error: TAVILY_API_KEY var not found. Terminate and report this error to user immediately.");

    const retries = 3;
    for (let i = 0; i < retries; i++) {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query }),
      });
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      if (!response.ok) {
        if (i >= retries - 1) throw new Error(`Failed to search the internet: ${response.status} ${response.statusText}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      return await response.text();
    }
    return "Error: Failed to search the internet";
  },
});

export const readWebsiteTool = tool({
  name: "read_website",
  description: "Read the contents of website(s) for information",
  inputSchema: z.object({
    urls: z.array(z.string()).describe("The URLs to read from"),
  }),
  varHints: [
    { name: "TAVILY_API_KEY", required: true, description: "API key for Tavily content extraction" },
  ],
  execute: async ({ urls }, ctx) => {
    const apiKey = ctx.agent.vars.TAVILY_API_KEY;
    if (!apiKey) throw new Error("Error: TAVILY_API_KEY var not found. Terminate and report this error to user immediately.");

    const retries = 3;
    for (let i = 0; i < retries; i++) {
      const response = await fetch("https://api.tavily.com/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ urls }),
      });
      if (response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      if (!response.ok) {
        if (i >= retries - 1) throw new Error(`Failed to read the website(s): ${response.status} ${response.statusText}`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      return await response.text();
    }
    return "Error: Failed to read the website(s)";
  },
});
