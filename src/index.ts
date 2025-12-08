import { AgentHub } from "@runtime";

import { sendGChatMessageTool } from "./hub/tools/comms";
import {
  getTopNTextTool,
  getTimeseriesTextTool,
} from "./hub/tools/security/analytics";
import { filesystem } from "./hub/middleware/fs";
import { planning } from "./hub/middleware/planning";
import CodeBlueprint from "./hub/agents/code";
import MainBlueprint from "./hub/agents/main";
import SecurityBlueprint from "./hub/agents/security";

const hub = new AgentHub({ defaultModel: "gpt-5-2025-08-07" })
  .use(planning)
  .use(filesystem)
  .addTool(sendGChatMessageTool, ["default"])
  .addTool(getTopNTextTool, ["security"])
  .addTool(getTimeseriesTextTool, ["security"])
  .addAgent(CodeBlueprint)
  .addAgent(MainBlueprint)
  .addAgent(SecurityBlueprint);
const { HubAgent, Agency, handler } = hub.export();
export { HubAgent, Agency };
export default handler;
