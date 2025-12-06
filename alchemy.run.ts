// TODO: replace wrangler with this. tried in the plane but turns out it needs internet (???? meme)
import {
  DurableObjectNamespace,
  Worker,
  KVNamespace,
  R2Bucket,
} from "alchemy/cloudflare";
import alchemy from "alchemy";

const app = await alchemy("agents-hub");

const hubAgent = DurableObjectNamespace("hub-agent", {
  className: "HubAgent",
  sqlite: true,
});

const agency = DurableObjectNamespace("agency", {
  className: "HubAgent",
  sqlite: true,
});

const agencyRegistry = await KVNamespace("agency-registry", {
  dev: { remote: false },
});

const fsBucket = await R2Bucket("fs-bucket", {
  name: "agent-files",
  dev: { remote: false },
});

export const worker = await Worker("Worker", {
  name: "my-worker",
  entrypoint: "./src/index.ts",
  bindings: {
    HUB_AGENT: hubAgent,
    AGENCY: agency,
    AGENCY_REGISTRY: agencyRegistry,
    FS: fsBucket,
  },
});

console.log(worker.url);
