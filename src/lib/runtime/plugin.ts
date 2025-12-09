import type { AgentMiddleware } from "./types";

export function defineMiddleware<TConfig>(
  mw: Omit<AgentMiddleware<TConfig>, "__configType">
): AgentMiddleware<TConfig> {
  return mw as AgentMiddleware<TConfig>;
}
