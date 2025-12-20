import { tool } from "@runtime";
import * as z from "zod";

export const sillyPing = tool({
  name: "silly_ping",
  description: "A very silly tool that replies with 'pong' and optionally echoes your message.",
  inputSchema: z.object({
    message: z
      .string()
      .optional()
      .describe("Optional message to echo back in the pong reply")
  }),
  execute: async ({ message }) => {
    return message ? `pong: ${message}` : "pong";
  }
});
