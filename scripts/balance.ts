import { Lucid, Koios } from "@lucid-evolution/lucid";
import { readFileSync } from "node:fs";
const keys = JSON.parse(readFileSync(".local/preprod-wallets.json", "utf8"));
const l = await Lucid(
  new Koios("https://preprod.koios.rest/api/v1"),
  "Preprod",
);
l.selectWallet.fromSeed(keys.maker);
const address = await l.wallet().address();
const u = await l.wallet().getUtxos();
console.log(
  JSON.stringify({
    address,
    ada: Number(u.reduce((a, u) => a + u.assets.lovelace, 0n)) / 1e6,
    utxos: u.length,
  }),
);
