import { tool } from "@runtime";
import * as z from "zod";

export const sendGChatMessageTool = tool({
  name: "send_gchat_message",
  description: "Send a message to GChat",
  inputSchema: z.object({
    text: z.string().describe("The content of the message to send")
  }),
  varHints: [
    { name: "GCHAT_WEBHOOK", required: true, description: "Google Chat webhook URL for posting messages" }
  ],
  execute: async ({ text }, ctx) => {
    const url = ctx.agent.vars.GCHAT_WEBHOOK;
    if (!url) throw new Error("Error: GCHAT_WEBHOOK var not found. Terminate and report this error to user immediately.")
      
    await fetch(
      url as string,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text })
      }
    );

    return "Message sent successfully";
  }
});
