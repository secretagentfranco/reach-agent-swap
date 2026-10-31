# Completed Preprod demo

One live sell-order scenario passed:

- 1,000 TOKEN X exchanged for exactly 2,000 TOKEN Y.
- 20 distinct wallets each received 50 X for 100 Y.
- Operator received 20 X upfront; no escrow remainder was left.
- 20 confirmed successful executions of the compiled escrow validator.
- Elena delegated four real Sōkusumi tasks: Hannah answered 8, Alex 10, Maya 12, Jamal 14. Recorded usage: 543.2881 credits. No outreach ran.

[Funding transaction and operator fee](https://preprod.cardanoscan.io/transaction/b170103bdcce10e5d812d4fc95e8ee2b3cab8c414663f26a0b53b7f63d66399c) · [All transaction receipts and agent results](evidence/preprod-demo.json) · [Test summary](evidence/test-summary.json)

The maker used the app's prepare/sign/submit API. The 20 test wallets called the contract directly. Buy and cancellation are implemented but were not separate live test scenarios.
