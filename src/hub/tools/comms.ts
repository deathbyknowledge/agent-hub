import { tool } from "@runtime";
import * as z from "zod";

`
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"text": "hello from curl"}' \
  "https://chat.googleapis.com/v1/spaces/AAQA7pwrRs4/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=J2NC-j5dZkugK8uA63Yu--mDQfkPG2SyTe7zEg5n_9c"
`;

export const sendGChatMessageTool = tool({
  name: "send_gchat_message",
  description: "Send a message to GChat",
  inputSchema: z.object({
    text: z.string().describe("The content of the message to send")
  }),
  execute: async ({ text }) => {
    await fetch(
      "https://chat.googleapis.com/v1/spaces/AAQA7pwrRs4/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=J2NC-j5dZkugK8uA63Yu--mDQfkPG2SyTe7zEg5n_9c",
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
