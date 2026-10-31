import express from "express";
import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { store } from "./store";
import {
  prepareOrder,
  prepareFill,
  prepareCancel,
  submit,
  reconcile,
  provider,
  operator,
} from "./chain";
import { crew, pollAgents, startAgents } from "./agents";
import { escrowAddress, keyOf } from "../shared/escrow";
import { validatorToScriptHash } from "@lucid-evolution/lucid";
import { validator } from "../shared/escrow";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "180kb" }));
app.use((req, res, next) => {
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    req.headers.origin !== `http://${req.headers.host}`
  ) {
    res.status(403).json({ error: "Use the local app origin" });
    return;
  }
  next();
});
const route = (fn: any) => (req: any, res: any) =>
  Promise.resolve(fn(req, res)).catch((e) =>
    res.status(400).json({ error: e.message ?? "Request failed" }),
  );
app.get("/api/config", (_req, res) => {
  const assets = existsSync("public/assets.json")
    ? JSON.parse(readFileSync("public/assets.json", "utf8"))
    : [];
  res.json({
    network: "Preprod",
    operator,
    feeBps: 200,
    escrowAddress,
    scriptHash: validatorToScriptHash(validator),
    crew,
    assets: [
      ...assets,
      {
        symbol: "ADA",
        name: "Test ADA",
        unit: "lovelace",
        decimals: 6,
        color: "#4168ed",
      },
    ],
  });
});
app.get("/api/orders", (_req, res) =>
  res.json(
    store
      .all("orders")
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => ({ ...o, agents: store.get("agents", o.id) })),
  ),
);
app.get(
  "/api/orders/:id",
  route(async (req: any, res: any) => {
    const o = store.get("orders", req.params.id);
    if (!o) return res.status(404).json({ error: "Order not found" });
    res.json({ ...o, agents: store.get("agents", o.id) });
  }),
);
app.get(
  "/api/wallet/:address",
  route(async (req: any, res: any) => {
    keyOf(req.params.address);
    const u = await provider.getUtxos(req.params.address);
    const b: Record<string, string> = {};
    for (const x of u)
      for (const [k, v] of Object.entries(x.assets))
        b[k] = (BigInt(b[k] ?? 0) + v).toString();
    res.json(b);
  }),
);
app.post(
  "/api/orders/prepare",
  route(async (req: any, res: any) => res.json(await prepareOrder(req.body))),
);
app.post(
  "/api/orders/:id/fill",
  route(async (req: any, res: any) =>
    res.json(
      await prepareFill(req.params.id, req.body.address, req.body.amount),
    ),
  ),
);
app.post(
  "/api/orders/:id/cancel",
  route(async (req: any, res: any) =>
    res.json(await prepareCancel(req.params.id, req.body.address)),
  ),
);
app.post(
  "/api/transactions/:id/submit",
  route(async (req: any, res: any) => {
    const p = await submit(req.params.id, req.body.witness);
    res.json({ id: p.id, txHash: p.hash, state: p.state, orderId: p.orderId });
  }),
);
app.get(
  "/api/transactions/:id",
  route(async (req: any, res: any) => {
    const p = await reconcile(req.params.id);
    if (!p) return res.status(404).json({ error: "Transaction not found" });
    res.json({
      id: p.id,
      txHash: p.hash,
      state: p.state,
      orderId: p.orderId,
      error: p.error,
    });
  }),
);
// Static public build only: wallets, database, sources and CLI credentials are never served.
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const port = Number(process.env.PORT ?? 5179);
app.listen(port, "127.0.0.1", () =>
  console.log(`Reach local app: http://127.0.0.1:${port}`),
);
let busy = false;
const tick = async () => {
  if (busy) return;
  busy = true;
  try {
    for (const p of store
      .all("transactions")
      .filter((p) => ["submitted", "submitting"].includes(p.state)))
      await reconcile(p.id).catch(() => {});
    for (const o of store
      .all("orders")
      .filter((o) => ["open", "filled"].includes(o.status))) {
      if (!store.get("agents", o.id)) await startAgents(o.id);
      await pollAgents(o.id);
    }
  } finally {
    busy = false;
  }
};
setInterval(() => void tick(), 30000);
void tick();
