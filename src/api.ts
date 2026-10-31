import { bech32 } from "@scure/base";
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const x = await r.json();
  if (!r.ok) throw Error(x.error ?? "Request failed");
  return x;
}
export type Wallet = {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
  signTx(cbor: string, partial: boolean): Promise<string>;
};
export function providers(): [string, any][] {
  return Object.entries((window as any).cardano ?? {}).filter(
    ([, v]: any) => v?.enable,
  );
}
export async function connect(provider: any) {
  const wallet: Wallet = await provider.enable();
  if ((await wallet.getNetworkId()) !== 0)
    throw Error("Switch your wallet to Cardano Preprod");
  const hex = await wallet.getChangeAddress();
  const address = bech32.encode(
    "addr_test",
    bech32.toWords(Uint8Array.from(hex.match(/../g)!, (v) => parseInt(v, 16))),
    150,
  );
  return { wallet, address };
}
export const short = (s: string) =>
  s ? s.slice(0, 7) + "…" + s.slice(-5) : "";
