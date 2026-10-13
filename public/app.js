import {
  Blockchain, generateWallet, signTransaction, computeState, COINBASE, BLOCK_REWARD,
} from "./chain.js";

const $ = (id) => document.getElementById(id);
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi"];
const short = (s, n = 8) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-4)}` : s);

let bc = new Blockchain({ difficulty: 3 });
const wallets = [];
let busy = false;

const nameOf = (addr) => (addr === COINBASE ? "COINBASE" : wallets.find((w) => w.address === addr)?.name ?? short(addr, 6));
const say = (el, text, kind = "") => { el.textContent = text; el.className = `msg ${kind}`; };

async function addWallet() {
  const w = await generateWallet();
  w.name = NAMES[wallets.length] ?? `Wallet ${wallets.length + 1}`;
  wallets.push(w);
  await render();
}

function fillSelects() {
  for (const id of ["tx-from", "tx-to", "miner"]) {
    const sel = $(id);
    const prev = sel.value;
    sel.innerHTML = wallets.map((w) => `<option value="${w.address}">${w.name}</option>`).join("");
    if (prev) sel.value = prev;
  }
  if (wallets.length > 1 && $("tx-to").value === $("tx-from").value) $("tx-to").selectedIndex = 1;
}

async function render() {
  const balances = await bc.balances();
  $("wallets").innerHTML = wallets
    .map((w) => `<li class="wallet"><span><b>${w.name}</b> <span class="addr">${short(w.address)}</span></span>
      <span>${balances.get(w.address) ?? 0} coins</span></li>`).join("");
  fillSelects();

  $("mempool-count").textContent = bc.mempool.length;
  $("mempool").innerHTML = bc.mempool.length
    ? bc.mempool.map((t) => `<li>${nameOf(t.from)} → ${nameOf(t.to)}: ${t.amount}</li>`).join("")
    : "<li>(empty)</li>";

  const v = await bc.validate();
  const status = $("status");
  status.className = `status ${v.valid ? "ok" : "bad"}`;
  status.textContent = v.valid
    ? `Chain valid (${bc.chain.length} blocks)`
    : `Chain INVALID from block #${v.firstInvalid} (${v.results.filter((r) => !r.valid).length} bad blocks)`;

  $("chain").innerHTML = bc.chain.map((b, i) => blockHtml(b, v.results[i])).join("");
  document.querySelectorAll(".tx input").forEach((inp) => inp.addEventListener("change", onEdit));
  document.querySelectorAll("[data-remine]").forEach((btn) => btn.addEventListener("click", onRemine));
}

function blockHtml(b, r) {
  const txs = b.transactions.map((t, j) => `
    <div class="tx">${nameOf(t.from)} → ${nameOf(t.to)}
      <input type="number" step="1" value="${t.amount}" data-block="${b.index}" data-tx="${j}" aria-label="amount">
      <div class="field">sig: ${t.signature ? short(t.signature, 10) : "(coinbase)"}</div>
    </div>`).join("");
  return `<div class="block ${r.valid ? "" : "invalid"}">
    <h4><span>Block #${b.index}</span><span class="tag">${r.valid ? "VALID" : "INVALID"}</span></h4>
    ${r.valid ? "" : `<div class="reason">${r.reason}</div>`}
    <div class="field">hash: <b>${short(b.hash, 12)}</b></div>
    <div class="field">prev: ${short(b.prevHash, 12)}</div>
    <div class="field">nonce: ${b.nonce} · difficulty: ${b.difficulty}</div>
    ${b.index === 0 ? '<div class="tx">Genesis block (no transactions)</div>' : txs}
    ${r.valid || b.index === 0 ? "" : `<button data-remine="${b.index}">Re-mine from here</button>`}
  </div>`;
}

// Editing a historical block: mutate it WITHOUT recomputing its hash, then re-validate.
async function onEdit(e) {
  const { block, tx } = e.target.dataset;
  bc.chain[+block].transactions[+tx].amount = Number(e.target.value);
  await render();
}

async function onRemine(e) {
  if (busy) return;
  busy = true;
  e.target.disabled = true;
  e.target.textContent = "Mining…";
  const res = await bc.remineFrom(+e.target.dataset.remine);
  busy = false;
  await render();
  if (!res.valid) say($("mine-msg"), `Re-mined hashes, but block #${res.firstInvalid} is still invalid: ${res.results[res.firstInvalid].reason}`, "err");
}

$("new-wallet").addEventListener("click", addWallet);

async function submitTx({ forge }) {
  const from = wallets.find((w) => w.address === $("tx-from").value);
  if (!from) return say($("tx-msg"), "Create a wallet first.", "err");
  const amount = Number($("tx-amount").value);
  const state = await computeState(bc.chain);
  const nonce = (state.nonces.get(from.address) ?? 0) + bc.mempool.filter((t) => t.from === from.address).length;
  const tx = await signTransaction(from, { to: $("tx-to").value, amount, nonce });
  if (forge) tx.amount = amount + 1; // changed after signing, so the signature no longer matches
  const err = await bc.addTransaction(tx);
  if (err) say($("tx-msg"), `Rejected: ${err}`, "err");
  else say($("tx-msg"), "Accepted into mempool.", "good");
  await render();
}

$("tx-form").addEventListener("submit", (e) => { e.preventDefault(); submitTx({ forge: false }); });
$("tx-forge").addEventListener("click", () => submitTx({ forge: true }));

$("mine-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const miner = $("miner").value;
  if (!miner) return say($("mine-msg"), "Create a wallet to receive the reward.", "err");
  bc.difficulty = Math.min(6, Math.max(1, Number($("difficulty").value) || 3));
  busy = true;
  $("mine-btn").disabled = true;
  const t0 = performance.now();
  try {
    const block = await bc.mine(miner, {
      onProgress: (n) => say($("mine-msg"), `Mining… ${n.toLocaleString()} hashes tried`),
    });
    say($("mine-msg"), `Mined block #${block.index} in ${((performance.now() - t0) / 1000).toFixed(2)}s (nonce ${block.nonce}). +${BLOCK_REWARD} coins.`, "good");
  } catch (err) {
    say($("mine-msg"), err.message, "err");
  }
  busy = false;
  $("mine-btn").disabled = false;
  await render();
});

$("reset").addEventListener("click", async () => {
  bc = new Blockchain({ difficulty: bc.difficulty });
  say($("mine-msg"), "");
  say($("tx-msg"), "");
  await render();
});

await addWallet();
await addWallet();
