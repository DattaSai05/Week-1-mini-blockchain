// Run with: node --test tools/
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  Blockchain, sha256, generateWallet, signTransaction, verifySignature, validateChain, validate_chain, computeState, BLOCK_REWARD,
} from "../public/chain.js";

const D = 1; // low difficulty keeps tests fast

async function fundedChain() {
  const bc = new Blockchain({ difficulty: D });
  const alice = await generateWallet();
  const bob = await generateWallet();
  await bc.mine(alice.address);
  return { bc, alice, bob };
}

const send = async (bc, from, to, amount) => {
  const nonce = ((await computeState(bc.chain)).nonces.get(from.address) ?? 0) + bc.mempool.filter((t) => t.from === from.address).length;
  return bc.addTransaction(await signTransaction(from, { to: to.address, amount, nonce }));
};

test("sha256 matches node:crypto, including multi-block and unicode input", () => {
  for (const s of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000), "héllo ✓"]) {
    assert.equal(sha256(s), createHash("sha256").update(s).digest("hex"), JSON.stringify(s.slice(0, 20)));
  }
});

test("ECDSA: valid signature verifies; any change or wrong key fails", async () => {
  const w = await generateWallet();
  const other = await generateWallet();
  const tx = await signTransaction(w, { to: other.address, amount: 5, nonce: 0 });
  assert.equal(await verifySignature(tx), true);
  assert.equal(await verifySignature({ ...tx, amount: 6 }), false);
  assert.equal(await verifySignature({ ...tx, from: other.address }), false);
  assert.equal(await verifySignature({ ...tx, signature: "zz" }), false);
});

test("mining produces a valid chain meeting difficulty and pays the reward", async () => {
  const { bc, alice } = await fundedChain();
  assert.ok(bc.tip.hash.startsWith("0".repeat(D)));
  assert.equal((await bc.balances()).get(alice.address), BLOCK_REWARD);
  assert.equal((await validate_chain(bc.chain)).valid, true);
});

test("difficulty is adjustable per block", async () => {
  const bc = new Blockchain({ difficulty: 1 });
  const w = await generateWallet();
  await bc.mine(w.address);
  bc.difficulty = 3;
  const b = await bc.mine(w.address);
  assert.equal(b.difficulty, 3);
  assert.ok(b.hash.startsWith("000"));
  assert.equal((await bc.validate()).valid, true);
});

test("transactions flow through mempool into a block and move balances", async () => {
  const { bc, alice, bob } = await fundedChain();
  assert.equal(await send(bc, alice, bob, 20), null);
  assert.equal(bc.mempool.length, 1);
  await bc.mine(alice.address);
  assert.equal(bc.mempool.length, 0);
  const bal = await bc.balances();
  assert.equal(bal.get(bob.address), 20);
  assert.equal(bal.get(alice.address), BLOCK_REWARD * 2 - 20);
  assert.equal((await bc.validate()).valid, true);
});

test("overspend is rejected, including against pending mempool spend", async () => {
  const { bc, alice, bob } = await fundedChain();
  assert.match(await send(bc, alice, bob, BLOCK_REWARD + 1), /insufficient balance/);
  assert.equal(await send(bc, alice, bob, 30), null);
  assert.match(await send(bc, alice, bob, 30), /insufficient balance/);
});

test("invalid signature, bad amount and replayed nonce are rejected", async () => {
  const { bc, alice, bob } = await fundedChain();
  const tx = await signTransaction(alice, { to: bob.address, amount: 10, nonce: 0 });
  assert.match(await bc.addTransaction({ ...tx, amount: 11 }), /invalid signature/);
  assert.match(await bc.addTransaction(await signTransaction(alice, { to: bob.address, amount: -5, nonce: 0 })), /positive integer/);
  assert.equal(await bc.addTransaction(tx), null);
  assert.match(await bc.addTransaction(tx), /bad nonce/); // replay
});

test("tampering with a historical block invalidates it and every later block", async () => {
  const { bc, alice, bob } = await fundedChain();
  await send(bc, alice, bob, 20);
  await bc.mine(alice.address);
  await bc.mine(alice.address);
  assert.equal(bc.chain.length, 4);
  bc.chain[2].transactions[1].amount = 1; // edit history, no re-mine
  const v = await validateChain(bc.chain);
  assert.equal(v.valid, false);
  assert.equal(v.firstInvalid, 2);
  assert.equal(v.results[1].valid, true);
  assert.match(v.results[2].reason, /hash mismatch/);
  assert.equal(v.results[3].valid, false);
  assert.match(v.results[3].reason, /follows invalid block #2/);
});

test("mining on a tampered chain is refused; re-mining a harmless edit repairs it", async () => {
  const { bc, alice } = await fundedChain();
  await bc.mine(alice.address);
  bc.chain[1].timestamp -= 1; // backwards, so it stays >= genesis and <= block 2
  await assert.rejects(() => bc.mine(alice.address), /invalid/);
  const res = await bc.remineFrom(1);
  assert.equal(res.valid, true);
});

test("forging the coinbase reward invalidates the block even after re-mining", async () => {
  const { bc, alice } = await fundedChain();
  bc.chain[1].transactions[0].amount = 1_000_000;
  const res = await bc.remineFrom(1);
  assert.equal(res.valid, false);
  assert.match(res.results[1].reason, /coinbase/);
});

test("longest chain wins; equal length does not replace; orphaned txs return to mempool", async () => {
  const a = new Blockchain({ difficulty: D });
  const b = new Blockchain({ difficulty: D });
  const wa = await generateWallet();
  const wb = await generateWallet();
  await a.mine(wa.address);
  await a.mine(wa.address);
  await send(a, wa, wb, 10);
  await a.mine(wa.address); // a: 4 blocks, includes tx
  await b.mine(wb.address);
  await b.mine(wb.address);
  assert.equal(await a.replaceChain(b.chain), false); // shorter
  await b.mine(wb.address);
  assert.equal(await a.replaceChain(b.chain), false); // equal length (4 vs 4)
  await b.mine(wb.address);
  assert.equal(await b.replaceChain(a.chain), false);
  assert.equal(await a.replaceChain(b.chain), true);
  assert.equal(a.tip.hash, b.tip.hash);
  // wa's coins lived only on the orphaned branch, so the orphaned tx cannot be re-admitted
  assert.equal(a.mempool.length, 0);
});

test("receiveBlock: accepts next block, ignores old, asks for chain on gap, rejects bad block", async () => {
  const a = new Blockchain({ difficulty: D });
  const b = new Blockchain({ difficulty: D });
  const w = await generateWallet();
  const b1 = await a.mine(w.address);
  assert.equal(await b.receiveBlock(b1), "accepted");
  assert.equal(await b.receiveBlock(b1), "ignored");
  await a.mine(w.address);
  const b3 = await a.mine(w.address);
  assert.equal(await b.receiveBlock(b3), "need_chain");
  const bad = structuredClone(a.chain[2]);
  bad.transactions[0].amount = 999;
  assert.equal(await b.receiveBlock(bad), "invalid");
});
