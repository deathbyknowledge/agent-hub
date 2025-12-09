import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import agentsPlugin from "./vite-plugin-agents";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    agentsPlugin({
      srcDir: "./src/hub",
      outFile: "./src/_generated.ts",
      defaultModel: "gpt-4o"
    }),
    cloudflare()
  ],
  resolve: {
    alias: {
      "@runtime": path.resolve(__dirname, "src/lib/runtime"),
      "@client": path.resolve(__dirname, "src/lib/client"),
      "@ui": path.resolve(__dirname, "src/ui")
    }
  }
});
