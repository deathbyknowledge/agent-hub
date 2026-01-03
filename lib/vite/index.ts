import * as fs from "node:fs";
import * as path from "node:path";
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

interface AgentsPluginOptions {
  srcDir?: string;
  outFile?: string;
  defaultModel?: string;
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
): string {
  const outDir = path.dirname(outFile);
  const imports: string[] = [];
  const toolRegistrations: string[] = [];
  const pluginRegistrations: string[] = [];
  const agentRegistrations: string[] = [];

  imports.push('import { AgentHub } from "agent-hub";');

  const hasSandboxCapability = !!process.env.SANDBOX;
  if (hasSandboxCapability) {
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

  if (hasSandboxCapability) {
    lines.push("export { HubAgent, Agency, Sandbox };");
  } else {
    lines.push("export { HubAgent, Agency };");
  }
  lines.push("export default handler;");
  lines.push("");

  return lines.join("\n");
}

export default function agentsPlugin(
  options: AgentsPluginOptions = {}
): Plugin {
  const srcDir = path.resolve(options.srcDir || "./hub");
  const outFile = path.resolve(options.outFile || "./_generated.ts");
  const defaultModel = options.defaultModel || "gpt-4o";

  function regenerate() {
    const discovery = discoverModules(srcDir);
    const code = generateCode(discovery, defaultModel, srcDir, outFile);

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, code, "utf-8");

    console.log(`[agents] Generated ${path.relative(process.cwd(), outFile)}`);
    console.log(`  - ${discovery.agents.length} agent(s)`);
    console.log(`  - ${discovery.tools.length} tool(s)`);
    console.log(`  - ${discovery.plugins.length} plugin(s)`);
  }

  // Generate immediately on plugin load (before Cloudflare plugin validates)
  regenerate();

  return {
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
}
