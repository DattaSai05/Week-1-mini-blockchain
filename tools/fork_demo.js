// Stretch demo: two unconnected nodes build conflicting chains (a fork), then connect and converge on the longest.
// Run with: node tools/fork_demo.js   (exits non-zero if the nodes do not converge)
import { GossipNode } from "./gossip_node.js";
import { generateWallet, signTransaction, computeState } from "../public/chain.js";

const waitFor = async (cond, ms = 10000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for convergence");
    await new Promise((r) => setTimeout(r, 50));
  }
};
const tip = (n) => `#${n.bc.tip.index} ${n.bc.tip.hash.slice(0, 12)}`;

const A = new GossipNode({ name: "A", port: 8081 });
const B = new GossipNode({ name: "B", port: 8082 });
await Promise.all([A.start(), B.start()]);
const wa = await generateWallet();
const wb = await generateWallet();

console.log("\n== Phase 1: partitioned. A mines 1 block, B mines 2 (a fork at height 1) ==");
await A.mineBlock(wa.address);
await B.mineBlock(wb.address);
await B.mineBlock(wb.address);
console.log(`A tip ${tip(A)}\nB tip ${tip(B)}`);

console.log("\n== Phase 2: connect. A should drop its block and adopt B's longer chain ==");
await A.connect("ws://localhost:8082");
await waitFor(() => A.bc.tip.hash === B.bc.tip.hash);
console.log(`A tip ${tip(A)}\nB tip ${tip(B)}`);

console.log("\n== Phase 3: gossip. B sends a signed tx, A mines it, B receives the block ==");
const nonce = (await computeState(B.bc.chain)).nonces.get(wb.address) ?? 0;
console.log("tx submitted at B:", (await B.submitTx(await signTransaction(wb, { to: wa.address, amount: 25, nonce }))) ?? "ok");
await waitFor(() => A.bc.mempool.length === 1);
await A.mineBlock(wa.address);
await waitFor(() => B.bc.tip.hash === A.bc.tip.hash);
console.log(`A tip ${tip(A)}\nB tip ${tip(B)}`);
console.log("balance of wa on B:", (await B.bc.balances()).get(wa.address));

const same = A.bc.tip.hash === B.bc.tip.hash;
console.log(same ? "\nPASS: both nodes converged" : "\nFAIL: nodes diverged");
await Promise.all([A.close(), B.close()]);
process.exit(same ? 0 : 1);
