// Blockchain core. One ES module shared by the browser UI and the Node gossip tools.
// Zero dependencies: SHA-256 is implemented synchronously (fast mining loop), ECDSA uses Web Crypto.

export const BLOCK_REWARD = 50;
export const COINBASE = "COINBASE";
export const DEFAULT_DIFFICULTY = 3; // leading hex zeros required in a block hash

// ---------- SHA-256 (sync) ----------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
const encoder = new TextEncoder();
const W = new Uint32Array(64);

export function sha256(str) {
  const msg = encoder.encode(str);
  const l = msg.length;
  const total = Math.ceil((l + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, Math.floor((l * 8) / 2 ** 32));
  dv.setUint32(total - 4, (l * 8) >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

// ---------- ECDSA (P-256) via Web Crypto ----------
const subtle = globalThis.crypto.subtle;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const SIGN = { name: "ECDSA", hash: "SHA-256" };

const toHex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => {
  if (typeof hex !== "string" || hex.length % 2 || /[^0-9a-f]/i.test(hex)) throw new Error("bad hex");
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
};

/** A wallet's address is its uncompressed public key (hex). The private key stays a JWK object. */
export async function generateWallet() {
  const pair = await subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  return {
    address: toHex(await subtle.exportKey("raw", pair.publicKey)),
    privateKey: await subtle.exportKey("jwk", pair.privateKey),
  };
}

export const txPayload = (tx) => JSON.stringify([tx.from, tx.to, tx.amount, tx.nonce]);
export const txId = (tx) => sha256(txPayload(tx));

export async function signTransaction(wallet, { to, amount, nonce }) {
  const tx = { from: wallet.address, to, amount, nonce, signature: "" };
  const key = await subtle.importKey("jwk", wallet.privateKey, ECDSA, false, ["sign"]);
  tx.signature = toHex(await subtle.sign(SIGN, key, encoder.encode(txPayload(tx))));
  return tx;
}

export async function verifySignature(tx) {
  try {
    const key = await subtle.importKey("raw", fromHex(tx.from), ECDSA, false, ["verify"]);
    return await subtle.verify(SIGN, key, fromHex(tx.signature), encoder.encode(txPayload(tx)));
  } catch {
    return false;
  }
}

export const coinbaseTx = (to, blockIndex) => ({
  from: COINBASE, to, amount: BLOCK_REWARD, nonce: blockIndex, signature: "",
});

// ---------- Blocks ----------
export function hashBlock(b) {
  return sha256(
    JSON.stringify([
      b.index, b.timestamp, b.prevHash,
      b.transactions.map((t) => [t.from, t.to, t.amount, t.nonce, t.signature]),
      b.nonce, b.difficulty,
    ]),
  );
}

export const meetsDifficulty = (hash, difficulty) => hash.startsWith("0".repeat(difficulty));

export function createGenesis() {
  const g = {
    index: 0, timestamp: 0, prevHash: "0".repeat(64),
    transactions: [], nonce: 0, difficulty: 0, hash: "",
  };
  g.hash = hashBlock(g);
  return g;
}

/** Proof of work: search for a nonce. Yields to the event loop so a UI / socket stays responsive. */
export async function proveWork(block, { signal, onProgress } = {}) {
  block.nonce = 0;
  for (;;) {
    for (let i = 0; i < 20000; i++, block.nonce++) {
      const hash = hashBlock(block);
      if (meetsDifficulty(hash, block.difficulty)) {
        block.hash = hash;
        return block;
      }
    }
    if (signal?.aborted) throw new Error("mining aborted");
    onProgress?.(block.nonce);
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ---------- Ledger state ----------
const newState = () => ({ balances: new Map(), nonces: new Map() });
const balanceOf = (s, a) => s.balances.get(a) ?? 0;
const nonceOf = (s, a) => s.nonces.get(a) ?? 0;

/** Apply a regular tx to `state`. Returns an error string, or null on success (state mutated). */
async function applyTx(state, tx, { checkSig = true } = {}) {
  if (!tx || typeof tx.from !== "string" || typeof tx.to !== "string") return "malformed transaction";
  if (tx.from === COINBASE) return "coinbase not allowed here";
  if (!Number.isSafeInteger(tx.amount) || tx.amount <= 0) return "amount must be a positive integer";
  if (checkSig && !(await verifySignature(tx))) return "invalid signature";
  if (tx.nonce !== nonceOf(state, tx.from)) return `bad nonce (expected ${nonceOf(state, tx.from)}, got ${tx.nonce})`;
  if (balanceOf(state, tx.from) < tx.amount) return `insufficient balance (has ${balanceOf(state, tx.from)}, needs ${tx.amount})`;
  state.balances.set(tx.from, balanceOf(state, tx.from) - tx.amount);
  state.balances.set(tx.to, balanceOf(state, tx.to) + tx.amount);
  state.nonces.set(tx.from, tx.nonce + 1);
  return null;
}

/** Best-effort balances for display / mempool admission; ignores per-tx failures. */
export async function computeState(chain) {
  const state = newState();
  for (const block of chain) {
    for (const tx of block.transactions) {
      if (tx.from === COINBASE) state.balances.set(tx.to, balanceOf(state, tx.to) + tx.amount);
      else await applyTx(state, tx, { checkSig: false });
    }
  }
  return state;
}

async function checkBlock(block, prev, state) {
  if (!block || !Array.isArray(block.transactions)) return "malformed block";
  if (hashBlock(block) !== block.hash) return "hash mismatch: block contents were changed";
  if (!meetsDifficulty(block.hash, block.difficulty)) return "hash does not meet proof-of-work difficulty";
  if (block.difficulty < 1) return "difficulty below minimum";
  if (block.prevHash !== prev.hash) return "prevHash does not match previous block";
  if (block.index !== prev.index + 1) return "bad block index";
  if (block.timestamp < prev.timestamp) return "timestamp earlier than previous block";
  const [cb, ...rest] = block.transactions;
  if (!cb || cb.from !== COINBASE || cb.amount !== BLOCK_REWARD || typeof cb.to !== "string")
    return "first transaction must be a valid coinbase reward";
  state.balances.set(cb.to, balanceOf(state, cb.to) + cb.amount);
  for (const [i, tx] of rest.entries()) {
    const err = await applyTx(state, tx);
    if (err) return `tx #${i + 1}: ${err}`;
  }
  return null;
}

/**
 * Validate an entire chain. Returns { valid, firstInvalid, results[] } where results[i] = { index, valid, reason }.
 * Once a block fails, every later block is reported invalid ("follows invalid block #k"),
 * because it builds on a history that no longer checks out.
 */
export async function validateChain(chain) {
  const results = [];
  let firstInvalid = null;
  const state = newState();
  const genesis = createGenesis();
  for (let i = 0; i < chain.length; i++) {
    let reason;
    if (firstInvalid !== null) reason = `follows invalid block #${firstInvalid}`;
    else if (i === 0) reason = JSON.stringify(chain[0]) === JSON.stringify(genesis) ? null : "genesis block differs";
    else reason = await checkBlock(chain[i], chain[i - 1], state);
    if (reason && firstInvalid === null) firstInvalid = i;
    results.push({ index: i, valid: reason === null, reason });
  }
  return { valid: firstInvalid === null && chain.length > 0, firstInvalid, results };
}
export const validate_chain = validateChain; // name used in the brief

// ---------- Blockchain (chain + mempool) ----------
export class Blockchain {
  constructor({ difficulty = DEFAULT_DIFFICULTY } = {}) {
    this.difficulty = difficulty;
    this.chain = [createGenesis()];
    this.mempool = [];
  }

  get tip() { return this.chain[this.chain.length - 1]; }

  validate() { return validateChain(this.chain); }

  /** Confirmed balances (chain only). */
  async balances() { return (await computeState(this.chain)).balances; }

  /** Admit a signed tx into the mempool. Returns null on success or an error string. */
  async addTransaction(tx) {
    const state = await computeState(this.chain);
    for (const pending of this.mempool) await applyTx(state, pending, { checkSig: false });
    const err = await applyTx(state, tx);
    if (err) return err;
    this.mempool.push(tx);
    return null;
  }

  async #buildTemplate(minerAddress) {
    const index = this.chain.length;
    const state = await computeState(this.chain);
    const txs = [];
    for (const tx of this.mempool) if ((await applyTx(state, tx, { checkSig: false })) === null) txs.push(tx);
    return {
      index, timestamp: Date.now(), prevHash: this.tip.hash,
      transactions: [coinbaseTx(minerAddress, index), ...txs],
      nonce: 0, difficulty: this.difficulty, hash: "",
    };
  }

  /** Mine the next block from the mempool and append it. Refuses to build on an invalid chain. */
  async mine(minerAddress, opts = {}) {
    if (!(await this.validate()).valid) throw new Error("chain is invalid; repair or reset it before mining");
    const template = await this.#buildTemplate(minerAddress);
    const block = await proveWork(template, opts);
    if (block.prevHash !== this.tip.hash) throw new Error("stale block: chain advanced while mining");
    this.#append(block);
    return block;
  }

  #append(block) {
    this.chain.push(block);
    const mined = new Set(block.transactions.map((t) => t.signature).filter(Boolean));
    this.mempool = this.mempool.filter((t) => !mined.has(t.signature));
  }

  /** Accept a block gossiped by a peer. Returns "accepted" | "ignored" | "need_chain" | "invalid". */
  async receiveBlock(block) {
    if (block.index <= this.tip.index) return "ignored";
    if (block.index > this.tip.index + 1 || block.prevHash !== this.tip.hash) return "need_chain";
    const { valid } = await validateChain([...this.chain, block]);
    if (!valid) return "invalid";
    this.#append(block);
    return "accepted";
  }

  /** Longest-chain rule: adopt `candidate` if it is valid and strictly longer. Orphaned txs go back to the mempool. */
  async replaceChain(candidate) {
    if (candidate.length <= this.chain.length) return false;
    if (!(await validateChain(candidate)).valid) return false;
    const inNew = new Set(candidate.flatMap((b) => b.transactions.map((t) => t.signature)));
    const orphaned = this.chain.flatMap((b) => b.transactions).filter((t) => t.from !== COINBASE && !inNew.has(t.signature));
    const oldMempool = this.mempool;
    this.chain = candidate;
    this.mempool = [];
    for (const tx of [...orphaned, ...oldMempool]) await this.addTransaction(tx);
    return true;
  }

  /** Repair after tampering: re-link and re-mine block `from` and everything after it. */
  async remineFrom(from, opts = {}) {
    for (let i = Math.max(from, 1); i < this.chain.length; i++) {
      const b = this.chain[i];
      b.prevHash = this.chain[i - 1].hash;
      await proveWork(b, opts);
    }
    return this.validate();
  }
}
