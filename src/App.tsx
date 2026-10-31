import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe2,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
  Wallet as WalletIcon,
  ArrowRight,
  CheckCircle2,
  Search,
  Layers,
  Clock3,
} from "lucide-react";
import { api, connect, providers, short, type Wallet } from "./api";
import { formatAmount, parseAmount, type Token } from "../shared/amounts";
type Order = any;
const colors = ["#f39ec5", "#a7a4f4", "#ffc88d", "#8fd3bb"];
const initials = ["H", "A", "M", "J"];
export default function App() {
  const [config, setConfig] = useState<any>(),
    [orders, setOrders] = useState<Order[]>([]),
    [side, setSide] = useState<"buy" | "sell">("sell"),
    [token, setToken] = useState<Token>(),
    [quote, setQuote] = useState<Token>(),
    [amount, setAmount] = useState(""),
    [total, setTotal] = useState(""),
    [wallet, setWallet] = useState<Wallet>(),
    [address, setAddress] = useState(""),
    [balances, setBalances] = useState<Record<string, string>>({}),
    [modal, setModal] = useState<"wallet" | "token" | "quote" | "how" | null>(
      null,
    ),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState(
      location.pathname.startsWith("/order/") ? "order" : "trade",
    ),
    [selected, setSelected] = useState<string | undefined>(
      location.pathname.split("/order/")[1],
    ),
    [fillAmount, setFillAmount] = useState(""),
    [fillPay, setFillPay] = useState(""),
    [editingPay, setEditingPay] = useState(false),
    [search, setSearch] = useState(""),
    [customUnit, setCustomUnit] = useState(""),
    [customSymbol, setCustomSymbol] = useState(""),
    [customDecimals, setCustomDecimals] = useState("6"),
    [extras, setExtras] = useState<Token[]>([]);
  useEffect(() => {
    api("/config")
      .then((c) => {
        setConfig(c);
        setToken(c.assets[0]);
        setQuote(c.assets[1] ?? c.assets[0]);
      })
      .catch((e) => setError(e.message));
    const refresh = () =>
      api("/orders")
        .then(setOrders)
        .catch(() => {});
    void refresh();
    const i = setInterval(refresh, 10000);
    const pop = () => {
      setSelected(location.pathname.split("/order/")[1]);
      setView(location.pathname.startsWith("/order/") ? "order" : "trade");
    };
    window.addEventListener("popstate", pop);
    return () => {
      clearInterval(i);
      window.removeEventListener("popstate", pop);
    };
  }, []);
  useEffect(() => {
    if (address)
      void api("/wallet/" + address)
        .then(setBalances)
        .catch(() => {});
  }, [address, busy]);
  function go(v: string, id?: string) {
    setView(v);
    setSelected(id);
    history.pushState(
      {},
      "",
      id ? "/order/" + id : v === "orders" ? "/orders" : "/",
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const order = orders.find((o) => o.id === selected),
    allAssets = [...(config?.assets ?? []), ...extras];
  const offer = side === "sell" ? token : quote,
    offerValue = side === "sell" ? amount : total;
  let fee = "0",
    deposit = "0";
  try {
    if (offer && offerValue) {
      const n = parseAmount(offerValue, offer.decimals),
        f = (n * 200n + 9999n) / 10000n;
      fee = formatAmount(f, offer.decimals);
      deposit = formatAmount(n + f, offer.decimals);
    }
  } catch {}
  const rate =
    Number(amount) > 0 && Number(total) > 0
      ? Number(total) / Number(amount)
      : null;
  async function action(fn: () => Promise<void>) {
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function sign(p: any) {
    if (!wallet) throw Error("Connect a wallet");
    setBusy("Confirm in your wallet");
    const witness = await wallet.signTx(p.cbor, true);
    setBusy("Submitting transaction");
    await api("/transactions/" + p.id + "/submit", { witness });
    setBusy("Waiting for Preprod confirmation");
    setNotice("Transaction submitted: " + short(p.txHash));
    const stop = Date.now() + 240000;
    while (Date.now() < stop) {
      await new Promise((r) => setTimeout(r, 5000));
      const x = await api("/transactions/" + p.id);
      if (x.state === "confirmed") {
        setOrders(await api("/orders"));
        return;
      }
    }
    throw Error(
      "Confirmation is pending. Keep the transaction hash and check the order before submitting again: " +
        p.txHash,
    );
  }
  async function create() {
    if (!wallet) {
      setModal("wallet");
      return;
    }
    await action(async () => {
      if (!token || !quote) throw Error("Select tokens");
      setBusy("Preparing escrow");
      const p = await api("/orders/prepare", {
        maker: address,
        side,
        token,
        quote,
        amount,
        total,
        hours: 24,
      });
      await sign(p);
      go("order", p.orderId);
      setNotice("Escrow funded. Elena is coordinating your demo team.");
    });
  }
  async function accept() {
    if (!wallet) {
      setModal("wallet");
      return;
    }
    await action(async () => {
      setBusy("Preparing your fill");
      const p = await api("/orders/" + order.id + "/fill", {
        address,
        amount: fillAmount,
      });
      await sign(p);
      setFillAmount("");
      setNotice(
        "Your exchange is confirmed. Tokens delivered directly to your wallet.",
      );
    });
  }
  async function connectWallet(p: any) {
    await action(async () => {
      setBusy("Connecting wallet");
      const x = await connect(p);
      setWallet(x.wallet);
      setAddress(x.address);
      setModal(null);
    });
  }
  function choose(a: Token) {
    if (modal === "token") setToken(a);
    else setQuote(a);
    setModal(null);
    setSearch("");
  }
  function custom() {
    if (
      !/^[a-f0-9]{56}([a-f0-9]{2}){0,32}$/.test(customUnit) ||
      !customSymbol ||
      !/^\d{1,2}$/.test(customDecimals) ||
      Number(customDecimals) > 12
    ) {
      setError("Use a Cardano asset unit, symbol and 0–12 decimals");
      return;
    }
    const a = {
      symbol: customSymbol.slice(0, 12),
      name: "Custom native asset",
      unit: customUnit,
      decimals: Number(customDecimals),
      color: "#8884e8",
    };
    setExtras((v) => [...v, a]);
    choose(a);
  }
  function TokenPill({
    asset,
    target,
  }: {
    asset?: Token;
    target?: "token" | "quote";
  }) {
    return (
      <button
        type="button"
        className="token-pill"
        onClick={() => target && setModal(target)}
        disabled={!target}
      >
        <span className="coin" style={{ background: asset?.color }}>
          {asset?.symbol.replace("TOKEN ", "").slice(0, 1) ?? "?"}
        </span>
        {asset?.symbol ?? "Select"}
        {target && <ChevronDown size={15} />}
      </button>
    );
  }
  function status(s: string) {
    return s === "COMPLETED"
      ? "Completed"
      : s === "RUNNING"
        ? "Working"
        : s === "INPUT_REQUIRED"
          ? "Plan approval"
          : s === "READY"
            ? "Queued"
            : s === "waiting"
              ? "Waiting"
              : (s ?? "Waiting");
  }
  function Crew({ state }: { state?: any }) {
    return (
      <section className="crew-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">YOUR AGENT TEAM</span>
            <h2>Four minds. One coordinator.</h2>
          </div>
          <span className="demo-tag">
            <span />
            Arithmetic demo
          </span>
        </div>
        <div className="coordinator">
          <span className="avatar elena">E</span>
          <div>
            <strong>
              Elena <span className="role">Coordinator</span>
            </strong>
            <p>
              {state?.status === "completed"
                ? "All four agent tasks completed."
                : state?.taskId
                  ? "Coordinating four real Sōkusumi tasks."
                  : "Starts after your escrow deposit confirms."}
            </p>
          </div>
          <span
            className={
              "state-dot " + (state?.status === "completed" ? "done" : "")
            }
          >
            {state?.status === "completed" ? (
              <Check size={16} />
            ) : (
              <Sparkles size={16} />
            )}
          </span>
        </div>
        <div className="connector" />
        <div className="crew-grid">
          {(
            config?.crew ?? [
              { name: "Hannah", role: "Research", question: "4+4" },
              { name: "Alex", role: "Analysis", question: "5+5" },
              { name: "Maya", role: "Creative", question: "6+6" },
              { name: "Jamal", role: "Outreach", question: "7+7" },
            ]
          ).map((c: any, i: number) => {
            const a = state?.children?.find(
              (a: any) => a.name === c.name || a.coworker === c.name,
            );
            return (
              <div className="agent-card" key={c.name}>
                <span className="avatar" style={{ background: colors[i] }}>
                  {initials[i]}
                </span>
                <strong>{c.name}</strong>
                <span>{c.role}</span>
                <div
                  className={
                    "agent-state " +
                    (a?.status === "COMPLETED" ? "complete" : "")
                  }
                >
                  {a?.status === "COMPLETED" ? (
                    <Check size={12} />
                  ) : (
                    <span className="little-dot" />
                  )}
                  {a ? status(a.status) : "Standby"}
                </div>
                <p>
                  {c.question} →{" "}
                  {a?.status === "COMPLETED"
                    ? String(a.result ?? "Result received")
                        .replace(/^\*\*Done\*\*:\s*/, "")
                        .replace(/\*/g, "")
                        .trim()
                        .slice(0, 55)
                    : "?"}
                </p>
                {a?.result && (
                  <details>
                    <summary>Actual result</summary>
                    <div className="raw-result">{a.result}</div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
        <div className="crew-note">
          <ShieldCheck size={15} />
          <span>
            Demo only. Agents answer simple questions. Nobody is contacted.
          </span>
        </div>
        {state?.error && <p className="inline-error">{state.error}</p>}
        {state?.credits > 0 && (
          <div className="subtle">
            Recorded usage: {state.credits.toFixed(2)} Preprod credits
          </div>
        )}
      </section>
    );
  }
  function OrderRows() {
    return (
      <section className="orders-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">THE OPEN MARKET</span>
            <h2>Find your other side.</h2>
          </div>
          <span className="count">
            {orders.filter((o) => o.status === "open").length} open orders
          </span>
        </div>
        {orders.length === 0 ? (
          <div className="empty">
            <Layers size={25} />
            <h3>Be the first to set a price.</h3>
            <p>Fund an order and share it with a counterparty.</p>
          </div>
        ) : (
          <div className="order-list">
            {orders.map((o) => (
              <button
                className="order-row"
                key={o.id}
                onClick={() => go("order", o.id)}
              >
                <div className="pair-coins">
                  <span className="coin" style={{ background: o.token.color }}>
                    {o.token.symbol.replace("TOKEN ", "")[0]}
                  </span>
                  <span className="coin" style={{ background: o.quote.color }}>
                    {o.quote.symbol.replace("TOKEN ", "")[0]}
                  </span>
                </div>
                <div>
                  <strong>
                    {o.side === "sell" ? "Sell" : "Buy"} {o.amount}{" "}
                    {o.token.symbol}
                  </strong>
                  <p>
                    For {o.total} {o.quote.symbol} · {o.fills?.length ?? 0}{" "}
                    fills
                  </p>
                </div>
                <span className={"order-status " + o.status}>
                  {o.status.replace("_", " ")}
                </span>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }
  let fillOffer: Token | undefined,
    fillAsk: Token | undefined,
    payment = "0",
    remaining = "0";
  if (order) {
    fillOffer = order.side === "sell" ? order.token : order.quote;
    fillAsk = order.side === "sell" ? order.quote : order.token;
    remaining = formatAmount(order.remaining, fillOffer!.decimals);
    try {
      const n = parseAmount(fillAmount, fillOffer!.decimals),
        num = BigInt(order.terms.priceNumerator),
        den = BigInt(order.terms.priceDenominator);
      payment = formatAmount((n * num + den - 1n) / den, fillAsk!.decimals);
    } catch {}
  }
  return (
    <>
      <header>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("trade");
          }}
        >
          <span className="brand-mark">✳</span>reach
          <span className="brand-period">.</span>
        </a>
        <nav>
          <button
            className={view === "trade" ? "active" : ""}
            onClick={() => go("trade")}
          >
            Trade
          </button>
          <button
            className={view === "orders" ? "active" : ""}
            onClick={() => go("orders")}
          >
            Orders{orders.length > 0 && <span>{orders.length}</span>}
          </button>
          <button onClick={() => setModal("how")}>
            How it works
            <ArrowUpRight size={13} />
          </button>
        </nav>
        <div className="header-right">
          <span className="network">
            <span />
            Cardano Preprod
          </span>
          <button className="wallet-button" onClick={() => setModal("wallet")}>
            <WalletIcon size={16} />
            {address ? short(address) : "Connect wallet"}
          </button>
        </div>
      </header>
      <main>
        {view === "trade" && (
          <>
            <div className="hero">
              <div className="hero-tag">
                <Sparkles size={13} />
                AN AGENT-POWERED EXCHANGE
              </div>
              <h1>
                Trade on your terms<span>.</span>
              </h1>
              <p>You set the price. Your agents find the other side.</p>
            </div>
            <section className="swap-card">
              <div className="swap-heading">
                <div className="tabs">
                  <button
                    className={side === "sell" ? "selected" : ""}
                    onClick={() => setSide("sell")}
                  >
                    Sell
                  </button>
                  <button
                    className={side === "buy" ? "selected" : ""}
                    onClick={() => setSide("buy")}
                  >
                    Buy
                  </button>
                </div>
                <button
                  className="icon-button"
                  aria-label="How escrow works"
                  onClick={() => setModal("how")}
                >
                  <ShieldCheck size={19} />
                </button>
              </div>
              <div className="amount-box">
                <div className="input-label">
                  {side === "sell" ? "You sell" : "You want to buy"}
                </div>
                <div className="amount-line">
                  <input
                    aria-label="Token amount"
                    inputMode="decimal"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                  <TokenPill asset={token} target="token" />
                </div>
                <div className="balance-line">
                  <span>Choose your amount</span>
                  {address && token && (
                    <span>
                      Balance:{" "}
                      {formatAmount(
                        balances[token.unit] ?? "0",
                        token.decimals,
                      )}
                    </span>
                  )}
                </div>
              </div>
              <button
                className="direction"
                aria-label="Switch token pair"
                onClick={() => {
                  const t = token;
                  setToken(quote);
                  setQuote(t);
                  setAmount(total);
                  setTotal(amount);
                }}
              >
                <ArrowDown size={18} />
              </button>
              <div className="amount-box receive">
                <div className="input-label">
                  {side === "sell"
                    ? "You receive in total"
                    : "You pay in total"}
                </div>
                <div className="amount-line">
                  <input
                    aria-label="Quote amount"
                    inputMode="decimal"
                    placeholder="0"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                  />
                  <TokenPill asset={quote} target="quote" />
                </div>
                <div className="balance-line">
                  <span>A fixed rate. No slippage.</span>
                  {address && quote && (
                    <span>
                      Balance:{" "}
                      {formatAmount(
                        balances[quote.unit] ?? "0",
                        quote.decimals,
                      )}
                    </span>
                  )}
                </div>
              </div>
              <div className="trade-meta">
                <span>
                  <span className="rate-dot" />
                  {rate
                    ? `1 ${token?.symbol} = ${rate.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${quote?.symbol}`
                    : "Your rate is locked in the contract"}
                </span>
                <span>24h expiry</span>
              </div>
              <div className="fee-box">
                <div>
                  <span>
                    Operator fee <span className="tiny-pill">2%</span>
                  </span>
                  <strong>
                    {fee} {offer?.symbol}
                  </strong>
                </div>
                <div>
                  <span>Total deposited from wallet</span>
                  <strong>
                    {deposit} {offer?.symbol}
                  </strong>
                </div>
                <p>
                  Includes the fee, paid upfront. Escrow also needs 3 test ADA,
                  plus wallet network fees.
                </p>
              </div>
              <button className="primary" disabled={!!busy} onClick={create}>
                {busy ? (
                  <>
                    <Loader2 className="spin" size={18} />
                    {busy}
                  </>
                ) : !wallet ? (
                  "Connect wallet"
                ) : !amount || !total ? (
                  "Enter an amount"
                ) : (
                  <>
                    Create {side} order
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
              <div className="swap-footer">
                <ShieldCheck size={13} />
                Non-custodial escrow<span>·</span>Partial fills welcome
              </div>
            </section>
            <div className="trust-line">
              <span>
                <ShieldCheck size={15} />
                Your tokens. Your rules.
              </span>
              <span>
                <Globe2 size={15} />A market beyond liquidity pools.
              </span>
            </div>
            <Crew />
            <OrderRows />
          </>
        )}
        {view === "orders" && (
          <div className="orders-page">
            <div className="page-heading">
              <span className="eyebrow">FIXED-RATE TOKEN ORDERS</span>
              <h1>A market on your terms.</h1>
              <p>Choose an order. Take the amount you want. Settle on-chain.</p>
              <button className="small-primary" onClick={() => go("trade")}>
                <Plus size={16} />
                Create order
              </button>
            </div>
            <OrderRows />
          </div>
        )}
        {view === "order" &&
          (!order ? (
            <div className="empty">
              {config ? "Loading order…" : "Connecting to Preprod…"}
            </div>
          ) : (
            <>
              <div className="detail-header">
                <button className="text-button" onClick={() => go("orders")}>
                  ← All orders
                </button>
                <span className={"order-status " + order.status}>
                  {order.status.replace("_", " ")}
                </span>
              </div>
              <div className="detail-layout">
                <div className="order-overview">
                  <span className="eyebrow">A DIRECT TOKEN EXCHANGE</span>
                  <h1>
                    {order.side === "sell" ? "Buy" : "Sell"}{" "}
                    {order.token.symbol}
                    <br />
                    <span>at their price.</span>
                  </h1>
                  <p>
                    The maker {order.side === "sell" ? "offers" : "wants"}{" "}
                    <strong>
                      {order.amount} {order.token.symbol}
                    </strong>{" "}
                    for{" "}
                    <strong>
                      {order.total} {order.quote.symbol}
                    </strong>
                    . Fill any available portion. The contract settles both
                    sides atomically.
                  </p>
                  <div className="order-facts">
                    <div>
                      <span>Available to receive</span>
                      <strong>
                        {remaining} {fillOffer?.symbol}
                      </strong>
                    </div>
                    <div>
                      <span>Confirmed fills</span>
                      <strong>{order.fills.length}</strong>
                    </div>
                    <div>
                      <span>Maker</span>
                      <a
                        href={
                          "https://preprod.cardanoscan.io/address/" +
                          order.maker
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(order.maker)}
                        <ArrowUpRight size={13} />
                      </a>
                    </div>
                    <div>
                      <span>Expires</span>
                      <strong>
                        {new Date(order.terms.expiresAt).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                  <button
                    className="share-button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(location.origin + "/order/" + order.id)
                        .then(() => setNotice("Counterparty link copied."))
                    }
                  >
                    <Copy size={15} />
                    Copy counterparty link
                  </button>
                  <a
                    className="chain-link"
                    href={
                      "https://preprod.cardanoscan.io/transaction/" +
                      order.fundingTx
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    View funding transaction
                    <ExternalLink size={13} />
                  </a>
                </div>
                <section className="swap-card fill-card">
                  <div className="swap-heading">
                    <strong>Take the other side</strong>
                    <ShieldCheck size={19} />
                  </div>
                  <div className="amount-box">
                    <div className="input-label">You receive</div>
                    <div className="amount-line">
                      <input
                        aria-label="Amount to receive"
                        inputMode="decimal"
                        placeholder="0"
                        value={fillAmount}
                        onChange={(e) => {
                          setEditingPay(false);
                          setFillAmount(e.target.value);
                        }}
                      />
                      <TokenPill asset={fillOffer} />
                    </div>
                    <div className="balance-line">
                      <span>Up to {remaining}</span>
                      <button
                        onClick={() => {
                          setEditingPay(false);
                          setFillAmount(remaining);
                        }}
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                  <div className="direction static">
                    <ArrowDown size={18} />
                  </div>
                  <div className="amount-box receive">
                    <div className="input-label">You give</div>
                    <div className="amount-line">
                      <input
                        aria-label="Amount to give"
                        inputMode="decimal"
                        placeholder="0"
                        value={editingPay ? fillPay : payment}
                        onBlur={() => setEditingPay(false)}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditingPay(true);
                          setFillPay(value);
                          try {
                            const paid = parseAmount(value, fillAsk!.decimals),
                              received =
                                (paid * BigInt(order.terms.priceDenominator)) /
                                BigInt(order.terms.priceNumerator);
                            setFillAmount(
                              received > 0n
                                ? formatAmount(received, fillOffer!.decimals)
                                : "",
                            );
                          } catch {
                            setFillAmount("");
                          }
                        }}
                      />
                      <TokenPill asset={fillAsk} />
                    </div>
                    <div className="balance-line">
                      Calculated at the maker's fixed rate
                    </div>
                  </div>
                  <div className="fee-box">
                    <div>
                      <span>Counterparty platform fee</span>
                      <strong>None</strong>
                    </div>
                    <p>
                      The maker paid the 2% fee when funding. You pay your
                      network fee and any minimum ADA required by the token
                      outputs.
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={
                      !!busy ||
                      order.status !== "open" ||
                      order.terms.expiresAt < Date.now()
                    }
                    onClick={accept}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="spin" size={18} />
                        {busy}
                      </>
                    ) : order.status === "filled" ? (
                      <>
                        <CheckCircle2 size={18} />
                        Order fully filled
                      </>
                    ) : order.status !== "open" ? (
                      "Order " + order.status
                    ) : !wallet ? (
                      "Connect to exchange"
                    ) : (
                      <>
                        Confirm exchange
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  {order.maker === address && order.status === "open" && (
                    <button
                      className="cancel-button"
                      onClick={() =>
                        void action(async () => {
                          setBusy("Preparing cancellation");
                          const p = await api(
                            "/orders/" + order.id + "/cancel",
                            { address },
                          );
                          await sign(p);
                          setNotice(
                            "Remaining escrow returned. The upfront fee is not refunded.",
                          );
                        })
                      }
                    >
                      Cancel & return remaining tokens
                    </button>
                  )}
                  <div className="swap-footer">
                    <ShieldCheck size={13} />
                    Wallet signatures. Contract-enforced exchange.
                  </div>
                </section>
              </div>
              <div className="fill-progress">
                <div>
                  <span>Order progress</span>
                  <strong>{order.fills.length} counterparties</strong>
                </div>
                <div className="progress-track">
                  <span
                    style={{
                      width:
                        100 *
                          (1 -
                            Number(order.remaining) /
                              Number(order.terms.remaining)) +
                        "%",
                    }}
                  />
                </div>
              </div>
              <Crew state={order.agents} />
              {order.fills.length > 0 && (
                <section className="fills">
                  <div className="section-title">
                    <h2>On-chain exchanges</h2>
                    <span>{order.fills.length} confirmed</span>
                  </div>
                  {order.fills.map((f: any, i: number) => (
                    <a
                      className="fill-row"
                      href={
                        "https://preprod.cardanoscan.io/transaction/" + f.txHash
                      }
                      target="_blank"
                      rel="noreferrer"
                      key={f.txHash}
                    >
                      <CheckCircle2 size={17} />
                      <span>
                        Counterparty {i + 1}
                        <small>{short(f.address)}</small>
                      </span>
                      <strong>
                        {formatAmount(f.amount, fillOffer!.decimals)}{" "}
                        {fillOffer?.symbol}
                      </strong>
                      <span>{short(f.txHash)}</span>
                      <ArrowUpRight size={16} />
                    </a>
                  ))}
                </section>
              )}
            </>
          ))}
        {error && (
          <div className="toast error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </main>
      <footer>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("trade");
          }}
        >
          reach.
        </a>
        <p>Find your other side.</p>
        <span>
          <span className="network-dot" />
          Built on Cardano · Preprod only
        </span>
      </footer>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "wallet"
                ? "Connect wallet"
                : modal === "how"
                  ? "How it works"
                  : "Select a token"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">
              <h2>
                {modal === "wallet"
                  ? "Connect a wallet"
                  : modal === "how"
                    ? "Your price. Your people."
                    : "Select a token"}
              </h2>
              <button
                className="icon-button"
                onClick={() => setModal(null)}
                aria-label="Close dialog"
              >
                <X size={21} />
              </button>
            </div>
            {modal === "wallet" ? (
              <>
                <p>
                  Use a Cardano wallet switched to <strong>Preprod</strong>.
                  Your private keys stay in your wallet.
                </p>
                {providers().map(([id, p]) => (
                  <button
                    className="wallet-choice"
                    key={id}
                    onClick={() => void connectWallet(p)}
                  >
                    {p.icon ? <img src={p.icon} alt="" /> : <WalletIcon />}
                    {p.name ?? id}
                    <ArrowRight size={16} />
                  </button>
                ))}
                {providers().length === 0 && (
                  <div className="empty">
                    <WalletIcon size={30} />
                    <h3>No wallet extension detected.</h3>
                    <p>
                      Open this app in Chrome with Lace or Eternl installed and
                      switched to Preprod. Test wallets stay in the private test
                      script.
                    </p>
                  </div>
                )}
                {address && <p className="subtle">Connected: {address}</p>}
              </>
            ) : modal === "how" ? (
              <div className="how">
                <div>
                  <b>01</b>
                  <h3>Set your exchange</h3>
                  <p>
                    Choose buy or sell, your tokens, the amount and the total
                    price. Deposit the offered tokens into escrow. A 2% fee is
                    paid to the operator upfront.
                  </p>
                </div>
                <div>
                  <b>02</b>
                  <h3>Elena brings the team</h3>
                  <p>
                    Four real Sōkusumi Coworkers are hired. This demo only asks
                    them arithmetic questions; it never contacts potential
                    buyers or sellers.
                  </p>
                </div>
                <div>
                  <b>03</b>
                  <h3>Share. Fill. Settle.</h3>
                  <p>
                    A counterparty opens the order link and chooses a portion.
                    They sign an atomic exchange at the exact fixed rate. Cancel
                    any unfilled remainder; the upfront fee stays paid.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <label className="search">
                  <Search size={17} />
                  <input
                    placeholder="Search tokens"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                <div className="token-options">
                  {allAssets
                    .filter((a) =>
                      a.symbol.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((a) => (
                      <button key={a.unit} onClick={() => choose(a)}>
                        <span className="coin" style={{ background: a.color }}>
                          {a.symbol.replace("TOKEN ", "")[0]}
                        </span>
                        <span>
                          <strong>{a.symbol}</strong>
                          <small>{a.name}</small>
                        </span>
                        {a.unit === "lovelace" ? (
                          <span className="subtle">Native</span>
                        ) : (
                          <span className="subtle">{short(a.unit)}</span>
                        )}
                      </button>
                    ))}
                </div>
                <details className="custom">
                  <summary>Add a native token</summary>
                  <input
                    placeholder="Policy ID + asset name hex"
                    value={customUnit}
                    onChange={(e) =>
                      setCustomUnit(e.target.value.toLowerCase())
                    }
                  />
                  <div>
                    <input
                      placeholder="Symbol"
                      value={customSymbol}
                      onChange={(e) => setCustomSymbol(e.target.value)}
                    />
                    <input
                      placeholder="Decimals"
                      value={customDecimals}
                      onChange={(e) => setCustomDecimals(e.target.value)}
                    />
                  </div>
                  <button className="small-primary" onClick={custom}>
                    Use this token
                  </button>
                  <p>Verify the asset unit and decimals with the issuer.</p>
                </details>
              </>
            )}
            {error && <p className="inline-error">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
