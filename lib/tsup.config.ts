import { defineConfig } from "tsup";

export default defineConfig([
  // Main library entries
  {
    entry: {
      "runtime/index": "runtime/index.ts",
      "client/index": "client/index.ts",
      "vite/index": "vite/index.ts",
      "runtime/plugins/index": "runtime/plugins/index.ts",
    },
    format: ["esm"],
    dts: true,
    clean: true,
    outDir: "dist",
    external: [
      // Cloudflare Workers runtime - not bundled
      "cloudflare:workers",
      // Peer dependencies
      "@cloudflare/workers-types",
      "@cloudflare/vite-plugin",
      // Dependencies - let consumer bundle these
      "agents",
      "itty-router",
      "zod",
      "zod-to-json-schema",
      // Node built-ins used by vite plugin
      "node:fs",
      "node:path",
      "node:module",
      // Vite - peer dep for vite plugin
      "vite",
    ],
    bundle: true,
    splitting: false,
    sourcemap: true,
    treeshake: true,
  },
  // CLI entry - separate config with shebang
  {
    entry: {
      "cli/index": "cli/index.ts",
    },
    format: ["esm"],
    dts: false,
    clean: false, // Don't clean, main build already did
    outDir: "dist",
    external: [
      // Node built-ins
      "node:fs",
      "node:path",
      "node:child_process",
      // Vite (spawned, not imported)
      "vite",
    ],
    bundle: true,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
