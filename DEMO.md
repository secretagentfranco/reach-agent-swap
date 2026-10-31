# Reach Preprod demo

Latest run: **4 counterparties**, each swapping 500 Y for 250 X, filled a 1,000 X / 2,000 Y order. The maker paid 20 X to the operator upfront. All four escrow executions were confirmed; no remainder was left.

Outreach ran four distinct Scout sessions for X, LinkedIn, Telegram and Instagram. The task was a normal buyer-finding request; simulation was imposed in system instructions with live search tools disabled. Reports were explicitly labelled simulated. No messages were sent.

- [Funding and 2% fee](https://preprod.cexplorer.io/tx/938f16d77b96478eaa2e39fa2c7a50da6a15baeee4ba34838a42edcde63fe319)
- [Final contract fill](https://preprod.cexplorer.io/tx/bdf94ee121a0681fa8f08d0de60ad0d1224d78bd988311b5ff379e6f9b895a94)
- [Completed Sōkusumi task](https://preprod.sokosumi.com/tasks/01a1922d-07a6-73fa-bd2e-085e9f72e241)
- [Receipts, Scout session IDs and tamper proof](evidence/preprod-four-wallet-demo.json)
- [Aiken contract](escrow/validators/escrow.ak)

**Tamper test:** offering 499,999,999 Y base units instead of the required 500,000,000 for 250 X was rejected by compiled Plutus validation against a live Preprod UTxO. This transaction was **not broadcast**.

The maker used the app's prepare/sign/submit API; the four test wallets called the contract directly. Screenshots, raw clips and logs were retained locally for the demo video. Buy and cancellation were not separate live test scenarios. The earlier [20-wallet run](evidence/preprod-demo.json) is retained as historical evidence.
