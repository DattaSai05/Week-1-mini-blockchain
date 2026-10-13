# Workflow: Build, test and deploy the blockchain showcase

## Objective
Ship a publicly reachable, install-free web page on Vercel that demonstrates a from-scratch blockchain, backed by a GitHub repo whose README includes a "What this does not do" section.

## Decisions (confirmed with user)
- Chain logic runs **in the browser** in JavaScript (ES module, Web Crypto API). No Python backend.
- Hosting: **Vercel** (static, no build step, `outputDirectory: public`).
- Stretch goal **in scope**: two Node nodes gossiping over websockets, longest-chain fork resolution.
- Deviation from the usual WAT layout: tools in `tools/` are JavaScript, not Python, because the chain must be one shared ES module used by both browser and Node.

## Required inputs
- Node.js >= 20 (global `crypto.subtle`, `node:test`). Installed locally? Check `node -v` first.
- GitHub account + repo (user creates or authorises creation).
- Vercel account / CLI login (user authorises).

## Layout
| Path | Purpose |
|---|---|
| `public/chain.js` | Single source of truth: blocks, PoW, ECDSA (P-256), mempool, balances, `validate_chain()`, longest-chain replacement |
| `public/index.html`, `app.js`, `style.css` | Browser UI |
| `tools/test_chain.js` | Unit tests (`npm test`) |
| `tools/gossip_node.js` | Websocket gossip node (stretch) |
| `tools/fork_demo.js` | Spins up two nodes, forces a fork, shows resolution |
| `vercel.json`, `package.json` | Deploy + dependency config (`ws` only) |
| `README.md` | Docs, incl. "What this does not do" |

## Steps
1. `npm install` (installs `ws` for the stretch tools only; the web page has zero dependencies).
2. `npm test` must pass before anything else.
3. Open `public/index.html` via a local static server (`npx serve public`) and walk through the acceptance checklist manually.
4. Stretch: `node tools/fork_demo.js` — expect both nodes to end on the same tip hash.
5. **Ask the user** before creating the GitHub repo, pushing, or deploying (outward-facing).
6. Deploy: `vercel --prod` from the project root. Verify the URL loads in a fresh/incognito window.
7. Add the live URL to the README.
8. User records the weekly defence (not automatable).

## Acceptance checklist
- [ ] Public URL loads and is interactive without installation
- [ ] Editing a historical block marks it and every later block invalid
- [ ] Transactions are signed; tampered/invalid signatures are rejected
- [ ] README "What this does not do" covers networking, many-node consensus, economic incentives
- [ ] Weekly defence recorded (user)

## Edge cases / design notes
- Vercel serverless cannot hold websocket connections, so gossip nodes are run locally, not deployed.
- Transactions carry a per-sender nonce to prevent replay; coinbase txs (block reward) are unsigned and only valid as the first tx of a block.
- Overspend is checked against confirmed balance minus pending mempool spend.
- Tamper validation reports *why* each block is invalid; blocks after the first broken one are flagged "follows invalid block #k" even if their own hash is self-consistent.
- Keep PoW difficulty low by default (3 hex zeros); each +1 is ~16x slower in the browser.

## Lessons learned
- Node 26: `node --test tools/` (bare directory) finds zero tests. Use `npm test`, which names the file explicitly (`node --test tools/test_chain.js`).
- Mining/validation timestamps: a block's timestamp must be >= its parent's. Tests that edit timestamps should move them backwards, since blocks mined in the same millisecond share a timestamp.
- Node installed via nvm is not on PATH for non-interactive shells; `~/.zshenv` exports the version bin dir.

_(Append further rate limits, quirks, and fixes here as they come up.)_
