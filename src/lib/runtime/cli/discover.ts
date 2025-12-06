import * as fs from "node:fs";
import * as path from "node:path";

export interface DiscoveredModule {
  /** Relative path from src/ */
  relativePath: string;
  /** Absolute path */
  absolutePath: string;
  /** Export names found (for named exports) */
  exports: string[];
  /** Whether it has a default export */
  hasDefault: boolean;
  /** Tags inferred from directory structure */
  inferredTags: string[];
  /** Capabilities parsed from blueprint definition (for agents) */
  blueprintCapabilities: string[];
}

export interface DiscoveryResult {
  agents: DiscoveredModule[];
  tools: DiscoveredModule[];
  middleware: DiscoveredModule[];
}

const TS_EXTENSIONS = [".ts", ".tsx"];

/**
 * Scan a directory for TypeScript files
 */
function scanDirectory(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Recurse into subdirectories
      files.push(...scanDirectory(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (TS_EXTENSIONS.includes(ext) && !entry.name.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Parse a TypeScript file to extract export information and blueprint capabilities.
 * Uses simple regex parsing - doesn't need full AST for this use case.
 */
function parseExports(filePath: string): {
  exports: string[];
  hasDefault: boolean;
  blueprintCapabilities: string[];
} {
  const content = fs.readFileSync(filePath, "utf-8");
  const exports: string[] = [];
  let hasDefault = false;
  const blueprintCapabilities: string[] = [];

  // Match: export const name = ...
  // Match: export function name(...
  // Match: export { name, name2 }
  // Match: export default ...

  // Named exports: export const/let/function/class name
  const namedExportRegex =
    /export\s+(?:const|let|var|function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Re-exports: export { name } or export { name as alias }
  const reExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(",").map((s) => {
      const parts = s.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    });
    exports.push(...names.filter((n) => n && n !== "default"));
  }

  // Default export
  if (/export\s+default\s/.test(content)) {
    hasDefault = true;
  }

  // Extract capabilities from blueprint definition: capabilities: ["@tag1", "tool_name"]
  const capsMatch = content.match(/capabilities:\s*\[([^\]]+)\]/);
  if (capsMatch) {
    const capStrings = capsMatch[1].match(/["']([^"']+)["']/g);
    if (capStrings) {
      for (const c of capStrings) {
        blueprintCapabilities.push(c.replace(/["']/g, ""));
      }
    }
  }

  return { exports: [...new Set(exports)], hasDefault, blueprintCapabilities };
}

/**
 * Infer tags from directory structure.
 * e.g., src/tools/security/analytics.ts → ["security"]
 */
function inferTags(filePath: string, baseDir: string): string[] {
  const relative = path.relative(baseDir, filePath);
  const parts = path.dirname(relative).split(path.sep);

  // Remove the category folder (agents/, tools/, middleware/)
  const tagParts = parts.slice(1).filter((p) => p && p !== ".");

  return tagParts;
}

/**
 * Discover all modules in the conventional directory structure.
 */
export function discoverModules(srcDir: string): DiscoveryResult {
  const result: DiscoveryResult = {
    agents: [],
    tools: [],
    middleware: []
  };

  const categories = [
    { key: "agents" as const, dir: "agents" },
    { key: "tools" as const, dir: "tools" },
    { key: "middleware" as const, dir: "middleware" }
  ];

  for (const { key, dir } of categories) {
    const categoryDir = path.join(srcDir, dir);
    const files = scanDirectory(categoryDir);

    for (const filePath of files) {
      const { exports, hasDefault, blueprintCapabilities } =
        parseExports(filePath);
      const relativePath = path.relative(srcDir, filePath);
      const inferredTags = inferTags(filePath, srcDir);

      result[key].push({
        relativePath,
        absolutePath: filePath,
        exports,
        hasDefault,
        inferredTags,
        blueprintCapabilities
      });
    }
  }

  return result;
}
