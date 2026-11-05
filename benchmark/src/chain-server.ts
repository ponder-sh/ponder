import { readFileSync } from "node:fs";
import type { Plan } from "../../simulation-test/src/plan.js";
import { serveChains } from "../../simulation-test/src/serve.js";

/**
 * Serve the chains of a plan in real time, until killed.
 *
 * Usage: `bun run src/chain-server.ts [plan file] [port]`
 */
const [planFile, port] = process.argv.slice(2);

const plan = JSON.parse(readFileSync(planFile!, "utf8")) as Plan;
const served = serveChains({ plan, port: Number(port) });

process.on("SIGTERM", () => {
  served.stop();
  process.exit(0);
});
