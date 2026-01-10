import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import hub from "agents-hub/vite";

export default defineConfig({
  plugins: [
    react(),
    hub({
      srcDir: "./hub",
      outFile: "./_generated.ts",
      defaultModel: "z-ai/glm-4.7",
      cloudflare: {
        name: "agents-hub",
        routes: [
          {
            pattern: "pi.deathbyknowledge.com",
            zone_name: "deathbyknowledge.com",
            custom_domain: true,
          },
        ],
      },
    }),
  ]
});
