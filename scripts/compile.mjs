import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
const local = "../hackathonTBC2026/.tools/aiken-aarch64-apple-darwin/aiken";
const r = spawnSync(existsSync(local) ? resolve(local) : "aiken", ["build"], {
  cwd: "escrow",
  encoding: "utf8",
});
if (r.status !== 0) {
  console.error((r.stderr + r.stdout).slice(-5000));
  process.exit(r.status ?? 1);
}
const blueprint = JSON.parse(readFileSync("escrow/plutus.json", "utf8"));
const v = blueprint.validators.find((v) => v.title === "escrow.escrow.spend");
writeFileSync(
  "contracts/escrow.json",
  JSON.stringify(
    {
      type: "PlutusV3",
      script: v.compiledCode,
      hash: v.hash,
      compiler: blueprint.preamble.compiler,
    },
    null,
    2,
  ) + "\n",
);
console.log("Partial-fill escrow compiled: " + v.hash);
