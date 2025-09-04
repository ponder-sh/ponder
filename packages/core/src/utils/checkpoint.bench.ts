import { bench, run } from "mitata";
import { encodeCheckpoint } from "./checkpoint.js";

bench("encodeCheckpoint", () => {
  // 115.84 ns/iter
  encodeCheckpoint({
    blockTimestamp: 1,
    chainId: 1,
    blockNumber: 1,
    transactionIndex: 1,
    eventType: 1,
    eventIndex: 1,
  });
}).gc("inner");

run();
