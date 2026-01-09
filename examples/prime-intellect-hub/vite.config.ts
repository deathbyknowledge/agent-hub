import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import hub from "agents-hub/vite";

const sandbox = (process.env.SANDBOX ?? "0") === "1";

export default defineConfig({
  plugins: [
    react(),
    hub({
      srcDir: "./hub",
      outFile: "./_generated.ts",
      defaultModel: "z-ai/glm-4.7",
      sandbox,
      cloudflare: {
        name: "agents-hub",
        routes: [
          {
            pattern: "pi.deathbyknowledge.com", // don't add this to yours :)
            zone_name: "deathbyknowledge.com",
            custom_domain: true,
          },
        ],
      },
    }),
  ]
});
