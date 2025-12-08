/**
 * Zod schemas for tool parameters.
 * These provide type inference AND auto-generate JSON Schema for providers.
 */
import { z } from "zod";

// ============================================================
// Filesystem
// ============================================================

// ============================================================
// Subagents
// ============================================================

export const TaskParams = z.object({
  description: z.string().describe("Task description for the subagent"),
  subagentType: z.string().describe("Type of subagent to spawn")
});
