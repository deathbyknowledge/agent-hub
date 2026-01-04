import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import hub from "agent-hub/vite";

const hasSandbox = (process.env.SANDBOX ?? "0") == "1";

export default defineConfig({
  plugins: [
    react(),
    hub({
      srcDir: "./hub",
      outFile: "./_generated.ts",
      defaultModel: "z-ai/glm-4.7",
    }),
    cloudflare({
      config: {
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
        ...(hasSandbox ? {
          durable_objects: {
            bindings: [
              {
                class_name: "Sandbox",
                name: "SANDBOX",
              },
            ],
          },
          containers: [
            {
              class_name: "Sandbox",
              image: "./Dockerfile",
              instance_type: "standard-2",
              max_instances: 2,
            },
          ],
        } : {}),
        main: "_generated.ts",
        migrations: [
          {
            new_sqlite_classes: ["HubAgent", "Agency"],
            tag: "v1",
          },
          {
            new_sqlite_classes: ["Sandbox"],
            tag: "v2",
          },
        ],
        name: "agents-hub",
        routes: [
          {
            pattern: "hub.deathbyknowledge.com", // don't add this to yours :)
            zone_name: "deathbyknowledge.com",
            custom_domain: true,
          },
        ],
      },
    }),
  ]
});
