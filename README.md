# Mini Blockchain

A from-scratch blockchain you can poke at in the browser: mine blocks, sign and submit transactions, edit history, and watch the chain break.

**Live demo:** _(add the Vercel URL after deploying)_

No installation needed. The page is static and all chain logic runs in your browser.

## Features
- Blocks holding a list of transactions, linked by SHA-256 hash
- Proof of work with adjustable difficulty (leading hex zeros, recorded per block)
- ECDSA (P-256) signature generation and verification via Web Crypto; invalid signatures are rejected
- `validate_chain()` that reports, per block, why it is invalid
- Mempool of pending transactions
- Balance tracking; overspending (including against pending mempool spends) and replayed nonces are rejected
- Browser UI: create wallets, submit (or forge) a transaction, mine, edit any historical transaction, and see that block and every block after it turn invalid. "Re-mine from here" repairs the chain.
- **Stretch:** two Node nodes gossip blocks and transactions over websockets and resolve forks with the longest-chain rule

## How tamper detection works
Each block's hash covers its index, timestamp, previous hash, transactions (including signatures), nonce and difficulty. Editing a past block changes its recomputed hash, so it no longer matches its stored hash. The next block still points at the old hash, so everything downstream is reported as `follows invalid block #k`. To make it valid again an attacker must re-mine that block and all later ones, and still cannot forge signatures or mint coins (only a fixed 50-coin coinbase is accepted per block).

## Project layout
| Path | What it is |
|---|---|
| `public/chain.js` | Blockchain core (browser + Node, no dependencies) |
| `public/index.html`, `app.js`, `style.css` | The UI |
| `tools/test_chain.js` | Tests |
| `tools/gossip_node.js`, `tools/fork_demo.js` | Websocket gossip nodes and a fork-resolution demo |
| `workflows/build_blockchain.md` | Build/deploy SOP |

## Run locally
Requires Node 20+.
```bash
npm install
npm test                 # unit tests
npm run serve            # serve public/ locally
npm run demo:fork        # two nodes: fork, gossip, convergence
node tools/gossip_node.js A 8081                          # or run nodes by hand:
node tools/gossip_node.js B 8082 ws://localhost:8081
```

## Deploy
Static site on Vercel: `vercel --prod` from the repo root (`vercel.json` serves `public/` with no build step). Websocket gossip nodes run locally only, since Vercel serverless functions cannot hold websocket connections.

## What this does not do
**Networking.** The deployed page is a single-user simulation in one browser tab; it is not connected to any peers. The gossip demo is two local processes over `ws://localhost`: no peer discovery, no NAT traversal, no encryption or authentication, no rate limiting, no protection against malicious or malformed peers beyond validating what they send.

**Consensus among many nodes.** Fork choice is plain "longest valid chain", with ties keeping the current chain. There is no difficulty retargeting (difficulty is whatever the miner picks, and any block with difficulty >= 1 is accepted), so a node can out-length honest nodes cheaply by mining at low difficulty; real chains compare cumulative work. There is no finality, no handling of timestamps beyond "not earlier than the previous block", no chain pruning, and the whole chain is sent on every sync. It has not been tested beyond two nodes.

**Economic incentives.** Block reward is a fixed 50 coins with no halving, no transaction fees, and no fee market, so there is no reason for a miner to prefer one transaction over another. Coins have no real value, and nothing models attacks that depend on incentives (selfish mining, 51% attacks, reorg costs, MEV).

Also out of scope: persistence (refreshing the page resets everything), secure key storage (private keys live in page memory), a UTXO model (this uses accounts with nonces), and Merkle trees (transactions are hashed directly into the block hash, so there are no light-client proofs).

## Status of acceptance criteria
- [ ] Public URL loads and is interactive without installation
- [ ] Tampering with a historical block visibly invalidates all subsequent blocks
- [ ] Transactions are signed and invalid signatures are rejected
- [x] README explains the omissions
- [ ] Weekly defence recorded
