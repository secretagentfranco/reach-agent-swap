# Reach

A Uniswap-style, fixed-rate token exchange on Cardano Preprod. A maker chooses what to buy or sell, locks the offered tokens in escrow, and shares an order link. Counterparties choose their amount and exchange tokens through the contract, with partial fills supported.

Elena coordinates four Sōkusumi agents to find counterparties.

The maker pays a **2% upfront operator fee**, in the deposited asset, on top of the escrow amount. The fee is included in the funding transaction; the Aiken contract enforces subsequent exchanges.

## Run

Requires Node.js 24, a Cardano Preprod wallet, and a Sōkusumi Preprod account with credits.

```sh
npm ci
npm run setup
npm run setup:cli
./sokosumi auth login
npm run build
npm run server
```

Open **http://127.0.0.1:5179**. Connect a CIP-30 wallet such as Lace or Eternl switched to Preprod. Set `OPERATOR_ADDRESS` in `.env` to use your own fee recipient; setup otherwise creates a test operator wallet.

## Demo test

With the server running, fund the maker address printed by setup with at least **500 test ADA**, then run:

```sh
npm run test:demo
```

One live scenario: sell 1,000 X for 2,000 Y, hire the four arithmetic agents, and fill the order from 20 distinct wallets. The operator receives 20 X upfront. [Completed demo and transaction proof](DEMO.md).

React/Vite frontend, Express/SQLite backend, Lucid transaction building, Aiken/Plutus V3 escrow. The compiled contract is included; rebuilding it requires Aiken 1.1.24 (`npm run contract`). Wallet seeds and runtime state stay in ignored `.local/`; users sign frontend transactions in their own wallets. Preprod hackathon prototype, not audited.
