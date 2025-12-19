/**
 * Vars Plugin
 *
 * Resolves $VAR references in tool call arguments at execution time.
 * Variables are looked up from agent.vars (which inherits from agency.vars).
 *
 * Pattern: $UPPERCASE_VAR_NAME (e.g., $ZONE_ID, $API_TOKEN)
 *
 * This enables "late binding" where:
 * - The model sees and uses symbolic references ($ZONE_ID)
 * - Resolution happens at tool execution time
 * - Secrets never appear in message history
 */
import type { AgentPlugin } from "@runtime";

/** Matches $VAR_NAME where VAR_NAME is uppercase letters, digits, underscores */
const VAR_PATTERN = /\$([A-Z][A-Z0-9_]*)/g;

/**
 * Recursively resolve $VAR references in a value.
 * Returns the original value if no vars found or var is undefined.
 */
function resolveVars(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    // Check if the entire string is a single var reference
    const fullMatch = value.match(/^\$([A-Z][A-Z0-9_]*)$/);
    if (fullMatch) {
      const varName = fullMatch[1];
      // Return the raw value (preserves type: number, boolean, object, etc.)
      return varName in vars ? vars[varName] : value;
    }

    // Otherwise do string interpolation
    return value.replace(VAR_PATTERN, (match, varName) => {
      if (varName in vars) {
        const resolved = vars[varName];
        return typeof resolved === "string" ? resolved : String(resolved);
      }
      return match; // Leave unresolved vars as-is
    });
  }

  if (Array.isArray(value)) {
    return value.map((v) => resolveVars(v, vars));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveVars(v, vars)])
    );
  }

  return value;
}

export const vars: AgentPlugin = {
  name: "vars",

  async onToolStart(ctx, call) {
    const agentVars = ctx.agent.vars as Record<string, unknown>;
    call.args = resolveVars(call.args, agentVars);
  },

  tags: ["default"],
};