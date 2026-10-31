import {
  AddressSchema,
  Constr,
  Data,
  credentialToAddress,
  getAddressDetails,
  validatorToAddress,
  type LucidEvolution,
  type SpendingValidator,
  type UTxO,
} from "@lucid-evolution/lucid";
import artifact from "../contracts/escrow.json";
export const validator: SpendingValidator = {
  type: "PlutusV3",
  script: artifact.script,
};
export const escrowAddress = validatorToAddress("Preprod", validator);
export const RESERVE = 3_000_000n;
export function keyOf(a: string) {
  const d = getAddressDetails(a);
  if (d.networkId !== 0 || d.paymentCredential?.type !== "Key")
    throw Error("Use a Preprod key wallet");
  return d.paymentCredential.hash;
}
export function splitUnit(u: string): [string, string] {
  if (u === "lovelace") return ["", ""];
  if (!/^[a-f0-9]{56}([a-f0-9]{2}){0,32}$/.test(u))
    throw Error("Invalid native token unit");
  return [u.slice(0, 56), u.slice(56)];
}
export function addressData(a: string): Data.Static<typeof AddressSchema> {
  const d = getAddressDetails(a);
  keyOf(a);
  return {
    addressCredential: { PubKeyCredential: [d.paymentCredential!.hash] },
    addressStakingCredential: d.stakeCredential
      ? {
          StakingHash: [
            d.stakeCredential.type === "Key"
              ? { PubKeyCredential: [d.stakeCredential.hash] }
              : { ScriptCredential: [d.stakeCredential.hash] },
          ],
        }
      : null,
  };
}
function addressFromData(a: Data.Static<typeof AddressSchema>) {
  if (!("PubKeyCredential" in a.addressCredential))
    throw Error("Invalid maker");
  const s = a.addressStakingCredential;
  let stake;
  if (s && "StakingHash" in s) {
    const c = s.StakingHash[0];
    stake =
      "PubKeyCredential" in c
        ? { type: "Key" as const, hash: c.PubKeyCredential[0] }
        : { type: "Script" as const, hash: c.ScriptCredential[0] };
  }
  return credentialToAddress(
    "Preprod",
    { type: "Key", hash: a.addressCredential.PubKeyCredential[0] },
    stake,
  );
}
const Schema = Data.Object({
  maker: AddressSchema,
  offerPolicy: Data.Bytes(),
  offerName: Data.Bytes(),
  askPolicy: Data.Bytes(),
  askName: Data.Bytes(),
  remaining: Data.Integer(),
  priceNumerator: Data.Integer(),
  priceDenominator: Data.Integer(),
  expiresAt: Data.Integer(),
  orderId: Data.Bytes(),
});
type Datum = Data.Static<typeof Schema>;
const DatumType = Schema as unknown as Datum;
export type Terms = {
  maker: string;
  offerUnit: string;
  askUnit: string;
  remaining: bigint;
  priceNumerator: bigint;
  priceDenominator: bigint;
  expiresAt: number;
  orderId: string;
};
export function encode(t: Terms) {
  const [offerPolicy, offerName] = splitUnit(t.offerUnit),
    [askPolicy, askName] = splitUnit(t.askUnit);
  return Data.to<Datum>(
    {
      maker: addressData(t.maker),
      offerPolicy,
      offerName,
      askPolicy,
      askName,
      remaining: t.remaining,
      priceNumerator: t.priceNumerator,
      priceDenominator: t.priceDenominator,
      expiresAt: BigInt(t.expiresAt),
      orderId: t.orderId,
    },
    DatumType,
  );
}
export function decode(cbor: string): Terms {
  const t = Data.from<Datum>(cbor, DatumType);
  return {
    maker: addressFromData(t.maker),
    offerUnit: t.offerPolicy + t.offerName || "lovelace",
    askUnit: t.askPolicy + t.askName || "lovelace",
    remaining: t.remaining,
    priceNumerator: t.priceNumerator,
    priceDenominator: t.priceDenominator,
    expiresAt: Number(t.expiresAt),
    orderId: t.orderId,
  };
}
export const price = (t: Terms, amount: bigint) =>
  (amount * t.priceNumerator + t.priceDenominator - 1n) / t.priceDenominator;
export const operatorFee = (amount: bigint) => (amount * 200n + 9999n) / 10000n;
export async function lock(l: LucidEvolution, t: Terms, operator: string) {
  keyOf(operator);
  keyOf(t.maker);
  splitUnit(t.offerUnit);
  splitUnit(t.askUnit);
  if (
    t.offerUnit === t.askUnit ||
    t.remaining <= 0n ||
    t.priceNumerator <= 0n ||
    t.priceDenominator <= 0n ||
    t.remaining > 9_000_000_000_000_000n ||
    t.expiresAt < Date.now() + 120000 ||
    t.expiresAt > Date.now() + 7 * 86400000 ||
    !/^[a-f0-9]{64}$/.test(t.orderId)
  )
    throw Error("Invalid order terms");
  const assets: { [u: string]: bigint } = { lovelace: RESERVE };
  assets[t.offerUnit] = (assets[t.offerUnit] ?? 0n) + t.remaining;
  return l
    .newTx()
    .pay.ToContract(escrowAddress, { kind: "inline", value: encode(t) }, assets)
    .pay.ToAddress(operator, { [t.offerUnit]: operatorFee(t.remaining) })
    .validTo(Date.now() + 180000)
    .complete();
}
export async function fill(l: LucidEvolution, u: UTxO, amount: bigint) {
  if (u.address !== escrowAddress || !u.datum)
    throw Error("Invalid escrow UTxO");
  const t = decode(u.datum),
    a = await l.wallet().address();
  if (keyOf(a) === keyOf(t.maker))
    throw Error("Use a different wallet to fill");
  if (amount <= 0n || amount > t.remaining || t.expiresAt < Date.now() + 30000)
    throw Error("Amount unavailable or order expired");
  const rest = { ...u.assets, [t.offerUnit]: u.assets[t.offerUnit] - amount };
  if (rest[t.offerUnit] === 0n) delete rest[t.offerUnit];
  let tx = l
    .newTx()
    .collectFrom(
      [u],
      Data.to(
        new Constr(0, [
          Data.from(
            Data.to<Data.Static<typeof AddressSchema>>(
              addressData(a),
              AddressSchema as unknown as Data.Static<typeof AddressSchema>,
            ),
          ),
          amount,
        ]),
      ),
    )
    .attach.SpendingValidator(validator)
    .addSigner(a)
    .validTo(Math.min(t.expiresAt - 1000, Date.now() + 180000))
    .pay.ToAddress(a, { [t.offerUnit]: amount });
  if (amount < t.remaining) {
    tx = tx.pay
      .ToContract(
        escrowAddress,
        {
          kind: "inline",
          value: encode({ ...t, remaining: t.remaining - amount }),
        },
        rest,
      )
      .pay.ToAddress(t.maker, { [t.askUnit]: price(t, amount) });
  } else {
    rest[t.askUnit] = (rest[t.askUnit] ?? 0n) + price(t, amount);
    tx = tx.pay.ToAddress(t.maker, rest);
  }
  return tx.complete();
}
export async function cancel(l: LucidEvolution, u: UTxO) {
  if (u.address !== escrowAddress || !u.datum) throw Error("Invalid escrow");
  const t = decode(u.datum);
  if (keyOf(await l.wallet().address()) !== keyOf(t.maker))
    throw Error("Only the maker can cancel");
  return l
    .newTx()
    .collectFrom([u], Data.to(new Constr(1, [])))
    .attach.SpendingValidator(validator)
    .addSigner(t.maker)
    .pay.ToAddress(t.maker, u.assets)
    .validTo(Date.now() + 180000)
    .complete();
}
