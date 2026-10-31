import "dotenv/config";
import { readFileSync } from "node:fs";
import { Koios, Lucid, type Provider, type UTxO } from "@lucid-evolution/lucid";
import { randomBytes, randomUUID } from "node:crypto";
import { store } from "./store";
import {
  decode,
  encode,
  escrowAddress,
  fill,
  keyOf,
  lock,
  cancel,
  type Terms,
} from "../shared/escrow";
import { parseAmount, type Token } from "../shared/amounts";
import { startAgents } from "./agents";
export const provider: Provider = new Koios(
  "https://preprod.koios.rest/api/v1",
);
export const operator =
  process.env.OPERATOR_ADDRESS ??
  JSON.parse(readFileSync("public/operator.json", "utf8")).address;
const serialize = (t: Terms) => ({
  ...t,
  remaining: t.remaining.toString(),
  priceNumerator: t.priceNumerator.toString(),
  priceDenominator: t.priceDenominator.toString(),
});
export async function wallet(address: string) {
  keyOf(address);
  const l = await Lucid(provider, "Preprod");
  l.selectWallet.fromAddress(address, await provider.getUtxos(address));
  return l;
}
export async function prepareOrder(input: any) {
  const { maker, side, token, quote } = input;
  if (!["buy", "sell"].includes(side)) throw Error("Choose buy or sell");
  for (const a of [token, quote]) {
    if (!a || typeof a.symbol !== "string" || a.symbol.length > 12)
      throw Error("Invalid token");
  }
  const amount = parseAmount(input.amount, token.decimals),
    total = parseAmount(input.total, quote.decimals);
  const t: Terms = {
    maker,
    offerUnit: side === "sell" ? token.unit : quote.unit,
    askUnit: side === "sell" ? quote.unit : token.unit,
    remaining: side === "sell" ? amount : total,
    priceNumerator: side === "sell" ? total : amount,
    priceDenominator: side === "sell" ? amount : total,
    expiresAt: Date.now() + Number(input.hours ?? 24) * 3600000,
    orderId: randomBytes(32).toString("hex"),
  };
  const tx = await lock(await wallet(maker), t, operator);
  const order = {
    id: t.orderId,
    maker,
    side,
    token,
    quote,
    amount: input.amount,
    total: input.total,
    terms: serialize(t),
    status: "awaiting_deposit",
    createdAt: Date.now(),
    remaining: t.remaining.toString(),
    fills: [],
    fundingTx: tx.toHash(),
  };
  store.put("orders", order.id, order);
  return saveTx(tx, "lock", order.id, maker);
}
function saveTx(
  tx: any,
  action: string,
  orderId: string,
  address: string,
  extra: object = {},
) {
  const p = {
    id: randomUUID(),
    hash: tx.toHash(),
    cbor: tx.toCBOR(),
    action,
    orderId,
    address,
    state: "prepared",
    createdAt: Date.now(),
    ...extra,
  };
  store.put("transactions", p.id, p);
  return { id: p.id, cbor: p.cbor, txHash: p.hash, orderId };
}
export async function current(orderId: string): Promise<UTxO | undefined> {
  const all = await provider.getUtxos(escrowAddress);
  return all.find((u) => {
    try {
      return !!u.datum && decode(u.datum).orderId === orderId;
    } catch {
      return false;
    }
  });
}
export async function prepareFill(
  orderId: string,
  address: string,
  amount: string,
) {
  const order = store.get("orders", orderId);
  if (!order) throw Error("Order not found");
  const u = await current(orderId);
  if (!u) throw Error("This order is filled or unavailable");
  const offer = order.side === "sell" ? order.token : order.quote;
  const units = parseAmount(amount, offer.decimals);
  return saveTx(
    await fill(await wallet(address), u, units),
    "fill",
    orderId,
    address,
    { amount: units.toString() },
  );
}
export async function prepareCancel(orderId: string, address: string) {
  const u = await current(orderId);
  if (!u) throw Error("Order unavailable");
  return saveTx(
    await cancel(await wallet(address), u),
    "cancel",
    orderId,
    address,
  );
}
export async function submit(id: string, witness: string) {
  const p = store.get("transactions", id);
  if (!p) throw Error("Unknown prepared transaction");
  if (["submitted", "confirmed"].includes(p.state)) return p;
  if (p.state !== "prepared")
    throw Error("Submission outcome uncertain; inspect the transaction hash");
  if (Date.now() - p.createdAt > 170000)
    throw Error("Transaction expired; prepare again");
  if (!/^[a-f0-9]+$/i.test(witness) || witness.length > 70000)
    throw Error("Invalid wallet signature");
  const l = await wallet(p.address);
  const signed = await l.fromTx(p.cbor).assemble([witness]).complete();
  if (signed.toHash() !== p.hash) throw Error("Transaction body mismatch");
  p.state = "submitting";
  store.put("transactions", id, p);
  try {
    await signed.submit();
    p.state = "submitted";
    store.put("transactions", id, p);
  } catch (e) {
    p.error = "Uncertain submission: inspect chain before retrying";
    store.put("transactions", id, p);
    throw e;
  }
  return p;
}
export async function reconcile(id: string) {
  const p = store.get("transactions", id);
  if (!p || !["submitted", "submitting"].includes(p.state)) return p;
  const status = await provider.getTransactionStatus!(p.hash);
  if (status.status !== "confirmed") return p;
  const order = store.get("orders", p.orderId);
  if (!order) return p;
  if (p.action === "lock") {
    const u = await current(order.id);
    if (
      !u ||
      u.txHash !== p.hash ||
      u.datum !==
        encode({
          ...order.terms,
          remaining: BigInt(order.terms.remaining),
          priceNumerator: BigInt(order.terms.priceNumerator),
          priceDenominator: BigInt(order.terms.priceDenominator),
        })
    )
      return p;
    order.status = "open";
    order.utxo = { txHash: u.txHash, outputIndex: u.outputIndex };
    order.remaining = decode(u.datum!).remaining.toString();
    store.put("orders", order.id, order);
    void startAgents(order.id);
  } else {
    const u = await current(order.id);
    order.remaining = u ? decode(u.datum!).remaining.toString() : "0";
    if (
      !order.fills.some((f: any) => f.txHash === p.hash) &&
      p.action === "fill"
    )
      order.fills.push({
        txHash: p.hash,
        address: p.address,
        amount: p.amount,
        at: Date.now(),
      });
    order.status = p.action === "cancel" ? "cancelled" : u ? "open" : "filled";
    store.put("orders", order.id, order);
  }
  p.state = "confirmed";
  p.confirmedAt = Date.now();
  store.put("transactions", id, p);
  return p;
}
export async function recordDirectFill(
  orderId: string,
  hash: string,
  address: string,
  amount: string,
) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Bad hash");
  const s = await provider.getTransactionStatus!(hash);
  if (s.status !== "confirmed") throw Error("Fill not confirmed");
  const id = "direct-" + hash;
  let p = store.get("transactions", id);
  if (!p) {
    p = {
      id,
      hash,
      address,
      amount,
      orderId,
      action: "fill",
      state: "submitted",
      createdAt: Date.now(),
    };
    store.put("transactions", id, p);
  }
  return reconcile(id);
}
