import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import agentsPlugin from "./vite-plugin-agents";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    agentsPlugin({
      srcDir: "./hub",
      outFile: "./_generated.ts",
      defaultModel: "gpt-5-2025-08-07",
      secret: "1234" // just use ur own or whatever
    }),
    cloudflare()
  ],
  resolve: {
    alias: {
      "@runtime": path.resolve(__dirname, "lib/runtime"),
      "@client": path.resolve(__dirname, "lib/client"),
      "@ui": path.resolve(__dirname, "src/ui")
    }
  }
});
