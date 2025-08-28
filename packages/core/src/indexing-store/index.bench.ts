import { onchainTable } from "@/index.js";
import { bench, run } from "mitata";
import { checkOnchainTable } from "./index.js";

const table = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint(),
}));

// 446.03 ps/iter
bench("checkOnchainTable", () => {
  checkOnchainTable(table, "find");
}).gc("inner");

run();
