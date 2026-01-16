import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      config: {
        name: "control-plane",
        compatibility_date: "2025-11-17",
        assets: {
          directory: "./dist",
          not_found_handling: "single-page-application",
        },
      },
    }),
  ],
  build: {
    outDir: "dist",
  },
});
