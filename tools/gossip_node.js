// Stretch goal: a node that gossips blocks and transactions over websockets and resolves forks by longest chain.
// Runs locally under Node (Vercel serverless cannot hold websocket connections).
import { WebSocketServer, WebSocket } from "ws";
import { Blockchain } from "../public/chain.js";

export class GossipNode {
  constructor({ name, port, difficulty = 2 }) {
    this.name = name;
    this.port = port;
    this.bc = new Blockchain({ difficulty });
    this.peers = new Set();
    this.abort = null;
    this.queue = Promise.resolve(); // handle inbound messages one at a time
  }

  start() {
    return new Promise((resolve) => {
      this.server = new WebSocketServer({ port: this.port }, resolve);
      this.server.on("connection", (ws) => this.#attach(ws));
    });
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on("open", () => { this.#attach(ws); resolve(); });
      ws.on("error", reject);
    });
  }

  close() {
    for (const ws of this.peers) ws.terminate();
    return new Promise((resolve) => this.server.close(resolve));
  }

  #attach(ws) {
    this.peers.add(ws);
    ws.on("close", () => this.peers.delete(ws));
    ws.on("error", () => {});
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      this.queue = this.queue.then(() => this.#handle(ws, msg)).catch((e) => console.error(`[${this.name}]`, e.message));
    });
    this.#send(ws, { type: "get_chain" }); // sync on connect
  }

  #send(ws, msg) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }

  #broadcast(msg, except) { for (const ws of this.peers) if (ws !== except) this.#send(ws, msg); }

  async #handle(ws, msg) {
    switch (msg.type) {
      case "get_chain":
        return this.#send(ws, { type: "chain", chain: this.bc.chain });
      case "chain":
        if (await this.bc.replaceChain(msg.chain)) {
          this.#log(`adopted longer chain, height ${this.bc.tip.index}`);
          this.abort?.abort();
          this.#broadcast({ type: "block", block: this.bc.tip }, ws);
        }
        return;
      case "block": {
        const r = await this.bc.receiveBlock(msg.block);
        if (r === "accepted") {
          this.#log(`accepted block #${msg.block.index}`);
          this.abort?.abort(); // our in-progress block is now stale
          this.#broadcast(msg, ws);
        } else if (r === "need_chain") {
          this.#send(ws, { type: "get_chain" }); // we are behind or forked: ask for the whole chain
        }
        return;
      }
      case "tx":
        if ((await this.bc.addTransaction(msg.tx)) === null) this.#broadcast(msg, ws);
        return;
    }
  }

  async submitTx(tx) {
    const err = await this.bc.addTransaction(tx);
    if (!err) this.#broadcast({ type: "tx", tx });
    return err;
  }

  /** Mine one block. Returns the block, or null if a peer's block arrived first. */
  async mineBlock(minerAddress) {
    this.abort = new AbortController();
    try {
      const block = await this.bc.mine(minerAddress, { signal: this.abort.signal });
      this.#log(`mined block #${block.index}`);
      this.#broadcast({ type: "block", block });
      return block;
    } catch (e) {
      if (/abort|stale/.test(e.message)) return null;
      throw e;
    }
  }

  #log(text) { console.log(`[${this.name}] ${text}`); }
}

// CLI: node tools/gossip_node.js <name> <port> [peerUrl ...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [name = "node", port = "8081", ...peers] = process.argv.slice(2);
  const node = new GossipNode({ name, port: Number(port) });
  await node.start();
  console.log(`[${name}] listening on ws://localhost:${port}`);
  for (const p of peers) await node.connect(p).then(() => console.log(`[${name}] connected to ${p}`));
}
