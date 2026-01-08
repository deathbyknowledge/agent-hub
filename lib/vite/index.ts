import * as fs from "node:fs";
import * as path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import type { Plugin, ViteDevServer } from "vite";

interface DiscoveredModule {
  relativePath: string;
  absolutePath: string;
  exports: string[];
  hasDefault: boolean;
  inferredTags: string[];
}

interface DiscoveryResult {
  agents: DiscoveredModule[];
  tools: DiscoveredModule[];
  plugins: DiscoveredModule[];
}

/**
 * Cloudflare wrangler config subset that users can customize.
 * The plugin will merge this with required defaults for agents-hub.
 */
export interface CloudflareConfig {
  name?: string;
  compatibility_date?: string;
  routes?: Array<{
    pattern: string;
    zone_name?: string;
    custom_domain?: boolean;
  }>;
  /** Additional durable_objects bindings (HubAgent/Agency are added automatically) */
  durable_objects?: {
    bindings?: Array<{
      class_name: string;
      name: string;
    }>;
  };
  /** Additional migrations (HubAgent/Agency migration is added automatically) */
  migrations?: Array<{
    new_sqlite_classes?: string[];
    tag: string;
  }>;
  /** Additional containers config */
  containers?: Array<{
    class_name: string;
    image: string;
    instance_type?: string;
    max_instances?: number;
  }>;
  /** Any other wrangler config options */
  [key: string]: unknown;
}

export interface AgentsPluginOptions {
  srcDir?: string;
  outFile?: string;
  defaultModel?: string;
  /**
   * Enable sandbox (container) support.
   * When true, adds Sandbox DO binding and container config.
   */
  sandbox?: boolean;
  /**
   * Cloudflare plugin configuration.
   * - If undefined: uses default cloudflare config
   * - If null: disables cloudflare plugin (codegen only)
   * - If object: merges with required defaults
   */
  cloudflare?: CloudflareConfig | null;
}

const TS_EXTENSIONS = [".ts", ".tsx"];

function scanDirectory(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];

  const files: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
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

function parseExports(filePath: string): {
  exports: string[];
  hasDefault: boolean;
} {
  const content = fs.readFileSync(filePath, "utf-8");
  const exports: string[] = [];
  let hasDefault = false;

  const namedExportRegex =
    /export\s+(?:const|let|var|function|class)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let match: RegExpExecArray | null;
  while ((match = namedExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  const reExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    const names = match[1].split(",").map((s) => {
      const parts = s.trim().split(/\s+as\s+/);
      return parts[parts.length - 1].trim();
    });
    exports.push(...names.filter((n) => n && n !== "default"));
  }

  if (/export\s+default\s/.test(content)) {
    hasDefault = true;
  }

  return { exports: [...new Set(exports)], hasDefault };
}

function inferTags(filePath: string, baseDir: string): string[] {
  const relative = path.relative(baseDir, filePath);
  const parts = path.dirname(relative).split(path.sep);
  return parts.slice(1).filter((p) => p && p !== ".");
}

function discoverModules(srcDir: string): DiscoveryResult {
  const result: DiscoveryResult = {
    agents: [],
    tools: [],
    plugins: [],
  };

  const categories = [
    { key: "agents" as const, dir: "agents" },
    { key: "tools" as const, dir: "tools" },
    { key: "plugins" as const, dir: "plugins" },
  ];

  for (const { key, dir } of categories) {
    const categoryDir = path.join(srcDir, dir);
    const files = scanDirectory(categoryDir);

    for (const filePath of files) {
      const { exports, hasDefault } = parseExports(filePath);
      const relativePath = path.relative(srcDir, filePath);
      const inferredTags = inferTags(filePath, srcDir);

      result[key].push({
        relativePath,
        absolutePath: filePath,
        exports,
        hasDefault,
        inferredTags,
      });
    }
  }

  return result;
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

function generateCode(
  discovery: DiscoveryResult,
  defaultModel: string,
  srcDir: string,
  outFile: string,
  sandbox: boolean,
): string {
  const outDir = path.dirname(outFile);
  const imports: string[] = [];
  const toolRegistrations: string[] = [];
  const pluginRegistrations: string[] = [];
  const agentRegistrations: string[] = [];

  imports.push('import { AgentHub } from "agents-hub";');

  if (sandbox) {
    imports.push('import { Sandbox } from "@cloudflare/sandbox";');
  }
  imports.push("");

  for (const mod of discovery.tools) {
    const absPath = path.join(srcDir, mod.relativePath);
    const importPath =
      "./" + path.relative(outDir, absPath).replace(/\.tsx?$/, "");
    const toolExports = mod.exports.filter(
      (exp) =>
        exp.toLowerCase().endsWith("tool") || exp.toLowerCase().includes("tool")
    );

    if (toolExports.length > 0) {
      imports.push(
        `import { ${toolExports.join(", ")} } from "${importPath}";`
      );
      for (const exp of toolExports) {
        const tags =
          mod.inferredTags.length > 0 ? mod.inferredTags : ["default"];
        toolRegistrations.push(`  .addTool(${exp}, ${JSON.stringify(tags)})`);
      }
    }
  }

  for (const mod of discovery.plugins) {
    const absPath = path.join(srcDir, mod.relativePath);
    const importPath =
      "./" + path.relative(outDir, absPath).replace(/\.tsx?$/, "");
    if (mod.exports.length > 0) {
      imports.push(
        `import { ${mod.exports.join(", ")} } from "${importPath}";`
      );
      for (const exp of mod.exports) {
        const tags = mod.inferredTags.length > 0 ? mod.inferredTags : undefined;
        if (tags) {
          pluginRegistrations.push(`  .use(${exp}, ${JSON.stringify(tags)})`);
        } else {
          pluginRegistrations.push(`  .use(${exp})`);
        }
      }
    }
  }

  for (const mod of discovery.agents) {
    const absPath = path.join(srcDir, mod.relativePath);
    const importPath =
      "./" + path.relative(outDir, absPath).replace(/\.tsx?$/, "");
    const baseName = path.basename(
      mod.relativePath,
      path.extname(mod.relativePath)
    );

    if (mod.hasDefault) {
      const varName = `${toPascalCase(baseName)}Blueprint`;
      imports.push(`import ${varName} from "${importPath}";`);
      agentRegistrations.push(`  .addAgent(${varName})`);
    }
  }

  const lines = [
    "// Auto-generated by vite-plugin-agents - do not edit manually",
    "",
    ...imports,
    "",
    `const hub = new AgentHub({ defaultModel: "${defaultModel}"})`,
    ...toolRegistrations,
    ...pluginRegistrations,
    ...agentRegistrations,
    ";",
    "",
    "const { HubAgent, Agency, handler } = hub.export();",
  ];

  if (sandbox) {
    lines.push("export { HubAgent, Agency, Sandbox };");
  } else {
    lines.push("export { HubAgent, Agency };");
  }
  lines.push("export default handler;");
  lines.push("");

  return lines.join("\n");
}

/**
 * Build cloudflare config with required defaults for agents-hub.
 */
function buildCloudflareConfig(
  userConfig: CloudflareConfig | undefined,
  outFile: string,
  sandbox: boolean,
): Record<string, unknown> {
  const mainFile = path.basename(outFile);

  // Required base config
  const baseConfig: Record<string, unknown> = {
    compatibility_date: "2025-11-17",
    compatibility_flags: ["nodejs_compat", "allow_importable_env"],
    assets: {
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*", "/agencies", "/agency/*", "/plugins"],
    },
    r2_buckets: [
      {
        binding: "FS",
        bucket_name: "agents-hub-fs",
      },
    ],
    main: mainFile,
  };

  // TODO: Auto-managing migration tags is fragile for existing deployments.
  // Consider letting users fully control migrations in the future.
  const baseMigrations = [
    {
      new_sqlite_classes: ["HubAgent", "Agency"],
      tag: "v1",
    },
  ];

  // Add sandbox config if enabled
  const sandboxDOBindings: Array<{ class_name: string; name: string }> = [];
  const sandboxMigrations: Array<{ new_sqlite_classes: string[]; tag: string }> = [];
  const sandboxContainers: Array<Record<string, unknown>> = [];

  if (sandbox) {
    sandboxDOBindings.push({
      class_name: "Sandbox",
      name: "SANDBOX",
    });
    sandboxMigrations.push({
      new_sqlite_classes: ["Sandbox"],
      tag: "v2",
    });
    sandboxContainers.push({
      class_name: "Sandbox",
      image: process.env.NODE_ENV === "development" ? "./Dockerfile" : "../../Dockerfile",
      instance_type: "standard-2",
      max_instances: 2,
    });
  }

  // Merge user config
  const {
    durable_objects: userDO,
    migrations: userMigrations,
    containers: userContainers,
    assets: userAssets,
    ...restUserConfig
  } = userConfig || {};

  // Merge durable_objects bindings
  const doBindings = [
    ...sandboxDOBindings,
    ...(userDO?.bindings || []),
  ];

  // Merge migrations (base + sandbox + user)
  const allMigrations = [
    ...baseMigrations,
    ...sandboxMigrations,
    ...(userMigrations || []),
  ];

  // Merge containers
  const allContainers = [
    ...sandboxContainers,
    ...(userContainers || []),
  ];

  // Merge assets config
  const mergedAssets = {
    ...(baseConfig.assets as Record<string, unknown>),
    ...(userAssets || {}),
  };

  const finalConfig: Record<string, unknown> = {
    ...baseConfig,
    ...restUserConfig,
    assets: mergedAssets,
    migrations: allMigrations,
  };

  if (doBindings.length > 0) {
    finalConfig.durable_objects = { bindings: doBindings };
  }

  if (allContainers.length > 0) {
    finalConfig.containers = allContainers;
  }

  return finalConfig;
}

/**
 * Creates the agents-hub Vite plugin with integrated Cloudflare support.
 *
 * @example
 * ```ts
 * import { defineConfig } from "vite";
 * import react from "@vitejs/plugin-react";
 * import hub from "agents-hub/vite";
 *
 * export default defineConfig({
 *   plugins: [
 *     react(),
 *     hub({
 *       srcDir: "./hub",
 *       defaultModel: "gpt-4o",
 *       sandbox: true,
 *       cloudflare: {
 *         name: "my-hub",
 *         routes: [{ pattern: "hub.example.com", ... }],
 *       },
 *     }),
 *   ]
 * });
 * ```
 */
export default function agentsPlugin(
  options: AgentsPluginOptions = {}
): Plugin | Plugin[] {
  const srcDir = path.resolve(options.srcDir || "./hub");
  const outFile = path.resolve(options.outFile || "./_generated.ts");
  const defaultModel = options.defaultModel || "gpt-4o";
  const sandbox = options.sandbox ?? false;

  function regenerate() {
    const discovery = discoverModules(srcDir);
    const code = generateCode(discovery, defaultModel, srcDir, outFile, sandbox);

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, code, "utf-8");

    console.log(`[agents] Generated ${path.relative(process.cwd(), outFile)}`);
    console.log(`  - ${discovery.agents.length} agent(s)`);
    console.log(`  - ${discovery.tools.length} tool(s)`);
    console.log(`  - ${discovery.plugins.length} plugin(s)`);
  }

  // Generate immediately on plugin load (before Cloudflare plugin validates)
  regenerate();

  const codegenPlugin: Plugin = {
    name: "vite-plugin-agents",
    enforce: "pre" as const,

    configureServer(server: ViteDevServer) {
      // Watch for changes in agents/, tools/, plugins/
      const watchDirs = ["agents", "tools", "plugins"].map((d) =>
        path.join(srcDir, d)
      );

      server.watcher.add(watchDirs);

      server.watcher.on("change", (file: string) => {
        if (watchDirs.some((dir) => file.startsWith(dir))) {
          console.log(
            `[agents] Detected change in ${path.relative(srcDir, file)}`
          );
          regenerate();
        }
      });

      server.watcher.on("add", (file: string) => {
        if (watchDirs.some((dir) => file.startsWith(dir))) {
          console.log(
            `[agents] Detected new file ${path.relative(srcDir, file)}`
          );
          regenerate();
        }
      });

      server.watcher.on("unlink", (file: string) => {
        if (watchDirs.some((dir) => file.startsWith(dir))) {
          console.log(
            `[agents] Detected deleted file ${path.relative(srcDir, file)}`
          );
          regenerate();
        }
      });
    },
  };

  // If cloudflare is explicitly null, return only the codegen plugin
  if (options.cloudflare === null) {
    return codegenPlugin;
  }

  // Build cloudflare config and return combined plugins
  const cfConfig = buildCloudflareConfig(options.cloudflare, outFile, sandbox);
  const cfPlugins = cloudflare({ config: cfConfig });
  const plugins = Array.isArray(cfPlugins) ? cfPlugins : [cfPlugins];

  return [codegenPlugin, ...plugins];
}
