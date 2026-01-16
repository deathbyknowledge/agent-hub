/**
 * Shared constants for styling and configuration
 */
import type { AgentStatus } from "./types";

// Status colors (background) - used by Sidebar
export const STATUS_BG_COLORS: Record<AgentStatus, string> = {
  running: "bg-[#00aaff]",
  paused: "bg-[#ffaa00]",
  done: "bg-[#00ff00]",
  error: "bg-[#ff0000]",
  idle: "bg-white/30",
};
