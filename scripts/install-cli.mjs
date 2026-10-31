import { spawnSync } from "node:child_process";
const r = spawnSync(
  "npm",
  [
    "install",
    "--prefix",
    ".tools/sokosumi",
    "--no-audit",
    "--no-fund",
    "@masumi_network/sokosumi@1.1.0",
  ],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
