import { defineConfig } from "vite";
import hub from "agents-hub/vite";

const sandbox = (process.env.SANDBOX ?? "0") === "1";

export default defineConfig({
  plugins: [
    hub({
      srcDir: "./hub",
      outFile: "./_generated.ts",
      defaultModel: "z-ai/glm-4.7",
      sandbox,
      cloudflare: {
        name: "agents-hub",
        routes: [
          {
            pattern: "hub.deathbyknowledge.com",
            zone_name: "deathbyknowledge.com",
            custom_domain: true,
          },
        ],
      },
    }),
  ],
  server: {
    cors: true, // Allow cross-origin requests from control-plane
  },
});
