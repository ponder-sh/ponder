import { and, eq, getTableName } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as PONDER_SYNC from "../../packages/core/src/sync-store/schema.js";

type JoinableTable =
  | typeof PONDER_SYNC.blocks
  | typeof PONDER_SYNC.transactions
  | typeof PONDER_SYNC.transactionReceipts
  | typeof PONDER_SYNC.traces
  | typeof PONDER_SYNC.logs;

export const getJoinConditions = (
  left: JoinableTable,
  right: JoinableTable,
): SQL => {
  if (left === right) throw new Error("Cannot join a table with itself");

  if (
    (left === PONDER_SYNC.blocks && right === PONDER_SYNC.transactions) ||
    (right === PONDER_SYNC.blocks && left === PONDER_SYNC.transactions)
  ) {
    return and(
      eq(PONDER_SYNC.blocks.chainId, PONDER_SYNC.transactions.chainId),
      eq(PONDER_SYNC.blocks.number, PONDER_SYNC.transactions.blockNumber),
    )!;
  }

  if (
    (left === PONDER_SYNC.blocks &&
      right === PONDER_SYNC.transactionReceipts) ||
    (right === PONDER_SYNC.blocks && left === PONDER_SYNC.transactionReceipts)
  ) {
    return and(
      eq(PONDER_SYNC.blocks.chainId, PONDER_SYNC.transactionReceipts.chainId),
      eq(
        PONDER_SYNC.blocks.number,
        PONDER_SYNC.transactionReceipts.blockNumber,
      ),
    )!;
  }

  if (
    (left === PONDER_SYNC.blocks && right === PONDER_SYNC.traces) ||
    (right === PONDER_SYNC.blocks && left === PONDER_SYNC.traces)
  ) {
    return and(
      eq(PONDER_SYNC.traces.chainId, PONDER_SYNC.blocks.chainId),
      eq(PONDER_SYNC.traces.blockNumber, PONDER_SYNC.blocks.number),
    )!;
  }

  if (
    (left === PONDER_SYNC.blocks && right === PONDER_SYNC.logs) ||
    (right === PONDER_SYNC.blocks && left === PONDER_SYNC.logs)
  ) {
    return and(
      eq(PONDER_SYNC.logs.chainId, PONDER_SYNC.blocks.chainId),
      eq(PONDER_SYNC.logs.blockNumber, PONDER_SYNC.blocks.number),
    )!;
  }

  if (
    (left === PONDER_SYNC.transactions &&
      right === PONDER_SYNC.transactionReceipts) ||
    (right === PONDER_SYNC.transactions &&
      left === PONDER_SYNC.transactionReceipts)
  ) {
    return and(
      eq(
        PONDER_SYNC.transactionReceipts.chainId,
        PONDER_SYNC.transactions.chainId,
      ),
      eq(
        PONDER_SYNC.transactionReceipts.blockNumber,
        PONDER_SYNC.transactions.blockNumber,
      ),
      eq(
        PONDER_SYNC.transactionReceipts.transactionIndex,
        PONDER_SYNC.transactions.transactionIndex,
      ),
    )!;
  }

  if (
    (left === PONDER_SYNC.transactions && right === PONDER_SYNC.traces) ||
    (right === PONDER_SYNC.transactions && left === PONDER_SYNC.traces)
  ) {
    return and(
      eq(PONDER_SYNC.traces.chainId, PONDER_SYNC.transactions.chainId),
      eq(PONDER_SYNC.traces.blockNumber, PONDER_SYNC.transactions.blockNumber),
      eq(
        PONDER_SYNC.traces.transactionIndex,
        PONDER_SYNC.transactions.transactionIndex,
      ),
    )!;
  }

  if (
    (left === PONDER_SYNC.transactions && right === PONDER_SYNC.logs) ||
    (right === PONDER_SYNC.transactions && left === PONDER_SYNC.logs)
  ) {
    return and(
      eq(PONDER_SYNC.logs.chainId, PONDER_SYNC.transactions.chainId),
      eq(PONDER_SYNC.logs.blockNumber, PONDER_SYNC.transactions.blockNumber),
      eq(
        PONDER_SYNC.logs.transactionIndex,
        PONDER_SYNC.transactions.transactionIndex,
      ),
    )!;
  }

  if (
    (left === PONDER_SYNC.transactionReceipts &&
      right === PONDER_SYNC.traces) ||
    (right === PONDER_SYNC.transactionReceipts && left === PONDER_SYNC.traces)
  ) {
    return and(
      eq(PONDER_SYNC.traces.chainId, PONDER_SYNC.transactionReceipts.chainId),
      eq(
        PONDER_SYNC.traces.blockNumber,
        PONDER_SYNC.transactionReceipts.blockNumber,
      ),
      eq(
        PONDER_SYNC.traces.transactionIndex,
        PONDER_SYNC.transactionReceipts.transactionIndex,
      ),
    )!;
  }

  if (
    (left === PONDER_SYNC.transactionReceipts && right === PONDER_SYNC.logs) ||
    (right === PONDER_SYNC.transactionReceipts && left === PONDER_SYNC.logs)
  ) {
    return and(
      eq(PONDER_SYNC.logs.chainId, PONDER_SYNC.transactionReceipts.chainId),
      eq(
        PONDER_SYNC.logs.blockNumber,
        PONDER_SYNC.transactionReceipts.blockNumber,
      ),
      eq(
        PONDER_SYNC.logs.transactionIndex,
        PONDER_SYNC.transactionReceipts.transactionIndex,
      ),
    )!;
  }

  throw new Error(
    `Invalid join: ${getTableName(left)} and ${getTableName(right)}`,
  );
};
