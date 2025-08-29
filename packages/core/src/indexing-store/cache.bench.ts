import { onchainTable } from "@/index.js";
import { bench, run } from "mitata";
import { getCopyText } from "./cache.js";

const table = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint(),
}));

const rows = [
  { address: "0x123", balance: 100n },
  { address: "0x456", balance: 200n },
  { address: "0x123", balance: 100n },
  { address: "0x456", balance: 200n },
  { address: "0x123", balance: 100n },
  { address: "0x456", balance: 200n },
  { address: "0x123", balance: 100n },
  { address: "0x456", balance: 200n },
  { address: "0x123", balance: 100n },
  { address: "0x456", balance: 200n },
];

bench("getCopyText", () => {
  getCopyText(table, rows);
}).gc("inner");

run();
