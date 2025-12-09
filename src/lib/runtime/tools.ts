/**
 * Tool definition utilities.
 * Adds `ToolContext` (agent, env, callId) to execute functions.
 */
import { type ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolContext, ToolJsonSchema, Tool } from "./types";

/** Tool result - string, object, or null (for async tools like subagents) */
export type ToolResult = string | object | null;

function isZodSchema(value: unknown): value is ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "_def" in value &&
    "parse" in value
  );
}

// ============================================================
// Tool Factory
// ============================================================

/**
 * Define a tool with Zod or JSON Schema input and typed execute function.
 * Matches AI SDK's `tool()` interface but with required `execute` and `ToolContext`.
 *
 * @example
 * ```ts
 * import { tool, z } from 'agents/sys';
 *
 * const read_file = tool({
 *   name: 'read_file',
 *   description: 'Read a file from the filesystem',
 *   inputSchema: z.object({
 *     path: z.string().describe('File path to read'),
 *     offset: z.number().int().min(0).optional(),
 *     limit: z.number().int().min(1).optional(),
 *   }),
 *   execute: async ({ path, offset, limit }, ctx) => {
 *     // ctx.agent, ctx.env, ctx.callId available
 *     const content = await ctx.agent.fs.readFile(path);
 *     return content ?? `Error: File '${path}' not found`;
 *   },
 * });
 * ```
 */
export function tool<TSchema extends ZodType | ToolJsonSchema>(config: {
  name: string;
  description?: string;
  inputSchema: TSchema;
  execute: (
    input: TSchema extends ZodType<infer T> ? T : unknown,
    ctx: ToolContext
  ) => Promise<ToolResult>;
}): Tool<TSchema extends ZodType<infer T> ? T : unknown> {
  let jsonSchema: ToolJsonSchema;
  if (isZodSchema(config.inputSchema)) {
    jsonSchema = zodToJsonSchema(config.inputSchema, {
      $refStrategy: "none",
      target: "openApi3"
    }) as ToolJsonSchema;
    delete jsonSchema.$schema;
  } else {
    jsonSchema = config.inputSchema;
  }

  return {
    meta: {
      name: config.name,
      description: config.description,
      parameters: jsonSchema
    },
    execute: config.execute
  };
}

export function isTool(obj: unknown): obj is Tool {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "meta" in obj &&
    "execute" in obj &&
    typeof (obj as Tool).execute === "function"
  );
}

export { z } from "zod";