// One live integration scenario: sell TOKEN X for TOKEN Y, four real agents,
// and four distinct wallets that execute the compiled partial-fill escrow.
import {
  Lucid,
  Koios,
  generateSeedPhrase,
  scriptFromNative,
  mintingPolicyToId,
  type LucidEvolution,
} from "@lucid-evolution/lucid";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import {
  fill,
  decode,
  escrowAddress,
  keyOf,
  operatorFee,
} from "../shared/escrow";
import { store } from "../server/store";
import { recordDirectFill, current, provider } from "../server/chain";
const API = "http://127.0.0.1:5179/api";
const count = Number(process.env.DEMO_WALLETS ?? 4);
if (![4, 20].includes(count)) throw Error("Use 4 or 20 counterparties");
const perX = 1_000_000_000n / BigInt(count),
  perY = 2_000_000_000n / BigInt(count);
const run = process.env.DEMO_RUN ?? "default";
if (!/^[a-z0-9-]+$/i.test(run)) throw Error("Invalid demo run name");
const path = process.env.DEMO_EVIDENCE ?? `evidence/sell-${count}-wallets.json`;
async function captureGate(stage: string) {
  if (process.env.DEMO_CAPTURE !== "true") return;
  e.captureStage = stage;
  save();
  console.log("CAPTURE READY: " + stage);
  const gate = `.local/capture-${run}-${stage}.ready`;
  while (!existsSync(gate)) await new Promise((r) => setTimeout(r, 1000));
}
const e: any = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : {
      scenario: `Sell TOKEN X for TOKEN Y; Outreach runs four platform Scout sessions in system-controlled demo mode; ${count} counterparties fill the escrow`,
      network: "Preprod",
      startedAt: new Date().toISOString(),
      transactions: [],
      checks: [],
      fills: [],
      phase: "setup",
    };
const save = () => writeFileSync(path, JSON.stringify(e, null, 2) + "\n");
async function api(route: string, body?: any) {
  const r = await fetch(API + route, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const x = await r.json();
  if (!r.ok) throw Error(x.error);
  return x;
}
const keys = JSON.parse(readFileSync(".local/preprod-wallets.json", "utf8"));
const assets = JSON.parse(readFileSync("public/assets.json", "utf8")),
  X = assets[0],
  Y = assets[1];
const operator =
  process.env.OPERATOR_ADDRESS ??
  JSON.parse(readFileSync("public/operator.json", "utf8")).address;
const maker = await Lucid(provider, "Preprod");
maker.selectWallet.fromSeed(keys.maker);
const makerAddress = await maker.wallet().address();
const takePath = `.local/demo-takers-${count}-${run}.json`;
if (!existsSync(takePath))
  writeFileSync(
    takePath,
    JSON.stringify(Array.from({ length: count }, () => generateSeedPhrase())),
    { mode: 0o600 },
  );
chmodSync(takePath, 0o600);
const seeds = JSON.parse(readFileSync(takePath, "utf8"));
if (seeds.length !== count) throw Error("Unexpected counterparty count");
const takers: LucidEvolution[] = [];
const addresses: string[] = [];
for (const seed of seeds) {
  const l = await Lucid(provider, "Preprod");
  l.selectWallet.fromSeed(seed);
  takers.push(l);
  addresses.push(await l.wallet().address());
}
if (new Set(addresses).size !== count) throw Error("Wallets must be distinct");
e.maker = makerAddress;
e.operator = operator;
e.wallets = addresses;
e.assets = { X, Y };
e.scriptAddress = escrowAddress;
e.offerAmount = "1000000000";
e.askAmount = "2000000000";
e.operatorFee = "20000000";
save();
async function balance(address: string, unit: string) {
  return (await provider.getUtxos(address)).reduce(
    (s, u) => s + (u.assets[unit] ?? 0n),
    0n,
  );
}
async function confirmed(hash: string) {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const s = await provider.getTransactionStatus!(hash);
    if (s.status === "confirmed") return;
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw Error(
    "Confirmation pending for " +
      hash +
      "; inspect saved evidence before retrying",
  );
}
async function send(
  l: LucidEvolution,
  label: string,
  build: () => Promise<any>,
) {
  let row = e.transactions.find((t: any) => t.label === label);
  if (row) {
    await confirmed(row.txHash);
    row.confirmed = true;
    save();
    return row.txHash;
  }
  const tx = await build();
  const signed = await tx.sign.withWallet().complete();
  const hash = signed.toHash();
  row = {
    label,
    txHash: hash,
    explorer: "https://preprod.cardanoscan.io/transaction/" + hash,
    confirmed: false,
    submittedAt: new Date().toISOString(),
    submission: "prepared",
  };
  e.transactions.push(row);
  save();
  try {
    await signed.submit();
    row.submission = "submitted";
    save();
  } catch (err) {
    row.submission = "uncertain";
    save();
    throw err;
  }
  console.log(label + ": submitted " + hash);
  await confirmed(hash);
  row.confirmed = true;
  save();
  console.log(label + ": confirmed");
  return hash;
}
try {
  if (!e.funded) {
    const ada = await balance(makerAddress, "lovelace");
    if (ada < BigInt(count) * 20_000_000n + 50_000_000n)
      throw Error("Insufficient test ADA; current " + ada);
    const policy = scriptFromNative({
      type: "sig",
      keyHash: keyOf(makerAddress),
    });
    if (
      !X.unit.startsWith(mintingPolicyToId(policy)) ||
      !Y.unit.startsWith(mintingPolicyToId(policy))
    )
      throw Error("Mint authority mismatch");
    await send(maker, `mint-X-Y-and-fund-${count}-wallets`, async () => {
      let tx = maker
        .newTx()
        .mintAssets({ [X.unit]: 10_000_000_000n, [Y.unit]: 30_000_000_000n })
        .attach.MintingPolicy(policy);
      for (const a of addresses)
        tx = tx.pay.ToAddress(a, {
          lovelace: 20_000_000n,
          [Y.unit]: perY,
        });
      return tx.complete();
    });
    e.funded = true;
    e.phase = "funded-wallets";
    save();
  }
  if (!e.orderId) {
    e.before = {
      makerX: (await balance(makerAddress, X.unit)).toString(),
      makerY: (await balance(makerAddress, Y.unit)).toString(),
      operatorX: (await balance(operator, X.unit)).toString(),
    };
    const p = await api("/orders/prepare", {
      maker: makerAddress,
      side: "sell",
      token: X,
      quote: Y,
      amount: "1000",
      total: "2000",
      hours: 24,
    });
    e.orderId = p.orderId;
    e.prepared = p;
    e.phase = "deposit-prepared";
    save();
  }
  if (!e.deposited) {
    await captureGate("initiator");
    const p = e.prepared;
    const witness = await maker.fromTx(p.cbor).partialSign.withWallet();
    await api("/transactions/" + p.id + "/submit", { witness });
    if (
      !e.transactions.some(
        (t: any) => t.label === "fund-escrow-and-2-percent-operator-fee",
      )
    )
      e.transactions.push({
        label: "fund-escrow-and-2-percent-operator-fee",
        txHash: p.txHash,
        explorer: "https://preprod.cardanoscan.io/transaction/" + p.txHash,
        confirmed: false,
      });
    save();
    await confirmed(p.txHash);
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      await api("/transactions/" + p.id);
      const o = await api("/orders/" + e.orderId);
      if (o.status === "open") break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    const order = await api("/orders/" + e.orderId);
    if (order.status !== "open") throw Error("Escrow deposit not reconciled");
    const operatorAfter = await balance(operator, X.unit);
    if (
      operatorAfter - BigInt(e.before.operatorX) !==
      operatorFee(1_000_000_000n)
    )
      throw Error("Upfront operator fee mismatch");
    e.transactions.find(
      (t: any) => t.label === "fund-escrow-and-2-percent-operator-fee",
    ).confirmed = true;
    e.deposited = true;
    e.phase = "agents-and-fills";
    e.checks.push({
      name: "2% upfront fee transferred in deposited TOKEN X",
      passed: true,
      feeBaseUnits: "20000000",
    });
    save();
    console.log(
      "Escrow funded; operator received 20 TOKEN X; Outreach workflow started.",
    );
  }
  await captureGate("funded");
  for (let i = 0; i < count; i++) {
    const label = "counterparty-" + String(i + 1).padStart(2, "0");
    let recorded = e.fills.find((f: any) => f.index === i);
    if (recorded) continue;
    await captureGate(`counterparty-${i + 1}-before`);
    const hash = await send(takers[i], label, async () => {
      const u = await current(e.orderId);
      if (!u) throw Error("Escrow unavailable at fill " + i);
      return fill(takers[i], u, perX);
    });
    await recordDirectFill(e.orderId, hash, addresses[i], perX.toString());
    const received = await balance(addresses[i], X.unit),
      spentY = await balance(addresses[i], Y.unit);
    if (received !== perX || spentY !== 0n)
      throw Error("Counterparty balances mismatch " + i);
    e.fills.push({
      index: i,
      wallet: addresses[i],
      txHash: hash,
      receivedX: received.toString(),
      remainingY: spentY.toString(),
    });
    save();
    console.log(
      `Fill ${i + 1}/${count} verified: ${perX / 1_000_000n} X for ${perY / 1_000_000n} Y`,
    );
    await captureGate(`counterparty-${i + 1}-after`);
  }
  const makerX = await balance(makerAddress, X.unit),
    makerY = await balance(makerAddress, Y.unit);
  if (makerY - BigInt(e.before.makerY) !== 2_000_000_000n)
    throw Error("Maker Y receipt mismatch");
  if (BigInt(e.before.makerX) - makerX !== 1_020_000_000n)
    throw Error("Maker X debit should include sale plus 2% fee");
  if (await current(e.orderId)) throw Error("Escrow remains after full fill");
  e.checks.push(
    {
      name: `${count} distinct signed fills; each receives ${perX / 1_000_000n} X and pays ${perY / 1_000_000n} Y`,
      passed: true,
    },
    {
      name: "Maker received exactly 2000 Y and paid 1000 X plus 20 X fee",
      passed: true,
    },
    { name: "Escrow fully consumed after final fill", passed: true },
  );
  e.phase = "waiting-agents";
  save();
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const order = await api("/orders/" + e.orderId);
    e.agents = order.agents;
    save();
    if (order.agents?.status === "completed") break;
    if (["failed", "uncertain"].includes(order.agents?.status))
      throw Error(
        "Agent workflow " +
          order.agents.status +
          ": " +
          (order.agents.error ?? ""),
      );
    console.log(
      "Agents: " +
        (order.agents?.status ?? "starting") +
        "; " +
        (order.agents?.children ?? [])
          .map((c: any) => c.name + "=" + c.status)
          .join(", "),
    );
    await new Promise((r) => setTimeout(r, 30000));
  }
  if (
    e.agents?.status !== "completed" ||
    e.agents.children.length !== 4 ||
    !e.agents.children.every((c: any) => c.status === "COMPLETED" && c.result)
  )
    throw Error("Four agent results not completed");
  if (e.agents.version === 2 && !e.agents.traceVerified)
    throw Error(
      "Four deployed Scout sessions were not verified; configure OUTREACH_TRACE_DIR",
    );
  e.checks.push({
    name: "Outreach ran four real platform Scout sessions and all completed",
    passed: true,
  });
  const r = await fetch("https://preprod.koios.rest/api/v1/tx_info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      _tx_hashes: e.fills.map((f: any) => f.txHash),
      _scripts: true,
      _inputs: true,
      _assets: true,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw Error("Receipt verification HTTP " + r.status);
  const rows = await r.json();
  const artifact = JSON.parse(readFileSync("contracts/escrow.json", "utf8"));
  e.receipts = e.fills.map((f: any) => {
    const tx = rows.find((t: any) => t.tx_hash === f.txHash);
    const executions = (tx?.plutus_contracts ?? []).filter(
      (c: any) => c.script_hash === artifact.hash && c.valid_contract === true,
    );
    if (!tx?.block_hash || executions.length !== 1)
      throw Error("Missing confirmed valid escrow execution " + f.txHash);
    return {
      txHash: f.txHash,
      blockHeight: tx.block_height,
      blockHash: tx.block_hash,
      scriptHash: artifact.hash,
      validEscrowExecutions: executions.length,
    };
  });
  e.checks.push({
    name: `${count} confirmed receipts each executed the exact compiled Plutus validator successfully`,
    passed: true,
  });
  e.phase = "completed";
  e.completedAt = new Date().toISOString();
  e.passed = true;
  save();
  console.log(
    `PASS: one live sell-order scenario, ${count} wallets, operator fee, four real Scout sessions. Evidence: ` +
      path,
  );
} catch (err) {
  e.error = (err as Error).message;
  e.failedAt = new Date().toISOString();
  save();
  console.error(e.error);
  process.exitCode = 1;
}
