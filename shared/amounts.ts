export function parseAmount(value: string, decimals: number) {
  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 12 ||
    !/^\d+(\.\d+)?$/.test(value)
  )
    throw Error("Enter a positive token amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw Error(`Maximum ${decimals} decimals`);
  const n =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (n <= 0n || n > 9_000_000_000_000_000n) throw Error("Amount out of range");
  return n;
}
export function formatAmount(value: string | bigint, decimals: number) {
  const n = BigInt(value),
    s = n.toString().padStart(decimals + 1, "0");
  if (!decimals) return s;
  return (s.slice(0, -decimals) + "." + s.slice(-decimals)).replace(
    /\.?0+$/,
    "",
  );
}
export type Token = {
  symbol: string;
  name: string;
  unit: string;
  decimals: number;
  color: string;
};
