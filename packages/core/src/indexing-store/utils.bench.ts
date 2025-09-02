import { onchainTable } from "@/index.js";
import { bench, run } from "mitata";
import {
  getCacheKey,
  getPrimaryKeyCache,
  normalizeColumn,
  normalizeRow,
} from "./utils.js";

const table = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
  balance: t.bigint(),
}));
const primaryKeyCache = getPrimaryKeyCache([table]);

// 7.47 ns/iter
bench("normalizeColumn", () => {
  normalizeColumn(table.address, "0x123", false);
}).gc("inner");

// 97.69 ns/iter
bench("normalizeRow", () => {
  normalizeRow(table, { address: "0x123" }, false);
}).gc("inner");

// 39.77 ns/iter
bench("getCacheKey", () => {
  getCacheKey(table, { address: "0x123" }, primaryKeyCache);
}).gc("inner");

run();
