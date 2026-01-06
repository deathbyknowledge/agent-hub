/**
 * Runtime Configuration Defaults
 * 
 * These values can be overridden via agent vars (set at agency or blueprint level).
 * Setting a value to 0 disables the corresponding limit/feature.
 */

// ============================================================
// LLM Provider Configuration
// ============================================================

/**
 * API key for the LLM provider.
 * Can be set globally via environment variable or per-agency/agent via vars.
 * 
 * @var LLM_API_KEY
 * @env LLM_API_KEY
 * @required true
 */
export const VAR_LLM_API_KEY = "LLM_API_KEY";

/**
 * Base URL for the LLM API (OpenAI-compatible endpoint).
 * Defaults to OpenAI's API if not set.
 * 
 * @var LLM_API_BASE
 * @env LLM_API_BASE
 * @default "https://api.openai.com/v1"
 * @example "https://openrouter.ai/api/v1"
 * @example "https://api.anthropic.com/v1"
 */
export const VAR_LLM_API_BASE = "LLM_API_BASE";
export const DEFAULT_LLM_API_BASE = "https://api.openai.com/v1";

/**
 * Default model to use when not specified in the blueprint.
 * 
 * @var DEFAULT_MODEL
 * @default undefined (must be set in blueprint or vars)
 */
export const VAR_DEFAULT_MODEL = "DEFAULT_MODEL";

// ============================================================
// Agent Loop Configuration
// ============================================================

/**
 * Maximum number of agent loop iterations before stopping with an error.
 * Each iteration involves either an LLM call or tool execution batch.
 * 
 * @var MAX_ITERATIONS
 * @default 200
 * @example Set to 0 to disable the limit
 */
export const DEFAULT_MAX_ITERATIONS = 200;

/**
 * Maximum number of tool calls to execute in parallel per tick.
 * Larger values increase throughput but may hit rate limits.
 * 
 * @var MAX_TOOLS_PER_TICK (not currently configurable via vars)
 * @default 25
 */
export const MAX_TOOLS_PER_TICK = 25;

// ============================================================
// Context Management Plugin Defaults
// ============================================================

/**
 * Number of recent messages to keep in full when summarizing.
 * These messages are not included in the summary and remain as-is.
 * 
 * @var CONTEXT_KEEP_RECENT
 * @default 20
 */
export const DEFAULT_CONTEXT_KEEP_RECENT = 20;

/**
 * Trigger summarization when message count exceeds this threshold.
 * Should be greater than CONTEXT_KEEP_RECENT.
 * 
 * @var CONTEXT_SUMMARIZE_AT
 * @default 40
 */
export const DEFAULT_CONTEXT_SUMMARIZE_AT = 40;

/**
 * Optional: Name of the memory disk to store extracted memories.
 * If not set, memories extracted during summarization are discarded.
 * 
 * @var CONTEXT_MEMORY_DISK
 * @default undefined
 */
export const DEFAULT_CONTEXT_MEMORY_DISK: string | undefined = undefined;

/**
 * Optional: Model to use for summarization.
 * If not set, uses the agent's default model.
 * 
 * @var CONTEXT_SUMMARY_MODEL
 * @default undefined (uses agent model)
 */
export const DEFAULT_CONTEXT_SUMMARY_MODEL: string | undefined = undefined;
