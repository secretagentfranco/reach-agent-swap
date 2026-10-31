import {
  generateSeedPhrase,
  Lucid,
  Koios,
  scriptFromNative,
  mintingPolicyToId,
  fromText,
} from "@lucid-evolution/lucid";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { keyOf } from "../shared/escrow";
mkdirSync(".local", { recursive: true, mode: 0o700 });
chmodSync(".local", 0o700);
const w = ".local/preprod-wallets.json";
if (!existsSync(w))
  writeFileSync(
    w,
    JSON.stringify({
      maker: generateSeedPhrase(),
      taker: generateSeedPhrase(),
    }),
    { mode: 0o600 },
  );
chmodSync(w, 0o600);
const p = ".local/operator-wallet.json";
if (!existsSync(p))
  writeFileSync(p, JSON.stringify({ seed: generateSeedPhrase() }), {
    mode: 0o600,
  });
chmodSync(p, 0o600);
const l = await Lucid(
  new Koios("https://preprod.koios.rest/api/v1"),
  "Preprod",
);
l.selectWallet.fromSeed(JSON.parse(readFileSync(p, "utf8")).seed);
const operator = await l.wallet().address();
writeFileSync(
  "public/operator.json",
  JSON.stringify(
    { address: operator, network: "Preprod", feeBps: 200 },
    null,
    2,
  ),
);
l.selectWallet.fromSeed(
  JSON.parse(readFileSync(".local/preprod-wallets.json", "utf8")).maker,
);
const maker = await l.wallet().address();
const policy = scriptFromNative({ type: "sig", keyHash: keyOf(maker) }),
  policyId = mintingPolicyToId(policy);
const existingAssets = existsSync("public/assets.json")
  ? JSON.parse(readFileSync("public/assets.json", "utf8"))
  : [];
if (
  !existingAssets.length ||
  existingAssets.some(
    (asset: { unit: string }) => !asset.unit.startsWith(policyId),
  )
) {
  const suffix = Date.now().toString(16).slice(-8);
  writeFileSync(
    "public/assets.json",
    JSON.stringify(
      [
        {
          symbol: "TOKEN X",
          name: "Demo token X",
          unit: policyId + fromText("X" + suffix),
          decimals: 6,
          color: "#fc68ad",
        },
        {
          symbol: "TOKEN Y",
          name: "Demo token Y",
          unit: policyId + fromText("Y" + suffix),
          decimals: 6,
          color: "#7771e8",
        },
      ],
      null,
      2,
    ),
  );
}
console.log("Preprod maker address (fund for the live demo): " + maker);
console.log(
  "Demo asset identities and operator address prepared. No transaction submitted.",
);
