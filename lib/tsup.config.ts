import { defineConfig } from "tsup";

export default defineConfig({
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
    // Dependencies - let consumer bundle these
    "agents",
    "itty-router",
    "zod",
    "zod-to-json-schema",
    // Node built-ins used by vite plugin
    "node:fs",
    "node:path",
    // Vite - peer dep for vite plugin
    "vite",
  ],
  // Preserve directory structure
  bundle: true,
  splitting: false,
  sourcemap: true,
  treeshake: true,
});
