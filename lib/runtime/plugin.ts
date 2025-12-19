import type { AgentPlugin } from "./types";

export function definePlugin<TConfig>(
  plugin: Omit<AgentPlugin<TConfig>, "__configType">
): AgentPlugin<TConfig> {
  return plugin as AgentPlugin<TConfig>;
}
