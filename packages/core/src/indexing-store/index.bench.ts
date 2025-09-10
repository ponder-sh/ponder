import { onchainTable } from "@/index.js";
import { bench, run } from "mitata";
import { checkOnchainTable, validateUpdateSet } from "./index.js";
import { getPrimaryKeyCache } from "./utils.js";

const table = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint(),
}));
const primaryKeyCache = getPrimaryKeyCache([table]);

// 446.03 ps/iter
bench("checkOnchainTable", () => {
  checkOnchainTable(table, "find");
}).gc("inner");

// 8.89 ns/iter
bench("validateUpdateSet", () => {
  validateUpdateSet(
    table,
    { address: "0x123" },
    { address: "0x123" },
    primaryKeyCache,
  );
}).gc("inner");

run();
