import type { Event } from "@/internal/types.js";
import type { Column, Table } from "drizzle-orm";

export const getAccessKey = (access: { [key: string]: string }): string => {
  return Object.values(access).join("_");
};

export const recoverAccess = (
  event: Event,
  table: Table,
  key: object,
  cache: Map<Table, [string, Column][]>,
): { [key: string]: string } | undefined => {
  const result: { [key: string]: string } = {};

  const eq = (
    target: bigint | string | number | boolean | null | undefined,
    value: bigint | string | number | boolean | null | undefined,
  ) => {
    if (!target) return false;
    if (target === value) return true;
    if (target && value && target.toString() === value.toString()) return true;
    return false;
  };

  for (const [js] of cache.get(table)!) {
    // @ts-ignore
    const value = key[js]!;

    if ("chainId" in result === false && eq(event.chainId, value)) {
      result[js] = "chainId";
      continue;
    }

    if ("id" in result === false && eq(event.event.id, value)) {
      result[js] = "id";
      continue;
    }

    switch (event.type) {
      case "block": {
        if (
          "block.hash" in result === false &&
          eq(event.event.block.hash, value)
        ) {
          result[js] = "block.hash";
          continue;
        }

        if (
          "block.number" in result === false &&
          eq(event.event.block.number, value)
        ) {
          result[js] = "block.number";
          continue;
        }

        if (
          "block.timestamp" in result === false &&
          eq(event.event.block.timestamp, value)
        ) {
          result[js] = "block.timestamp";
          continue;
        }

        if (
          "block.miner" in result === false &&
          eq(event.event.block.miner, value)
        ) {
          result[js] = "block.miner";
          continue;
        }

        break;
      }

      case "transaction": {
        if (
          "block.hash" in result === false &&
          eq(event.event.block.hash, value)
        ) {
          result[js] = "block.hash";
          continue;
        }

        if (
          "block.number" in result === false &&
          eq(event.event.block.number, value)
        ) {
          result[js] = "block.number";
          continue;
        }

        if (
          "block.timestamp" in result === false &&
          eq(event.event.block.timestamp, value)
        ) {
          result[js] = "block.timestamp";
          continue;
        }

        if (
          "block.miner" in result === false &&
          eq(event.event.block.miner, value)
        ) {
          result[js] = "block.miner";
          continue;
        }

        if (
          "transaction.hash" in result === false &&
          eq(event.event.transaction.hash, value)
        ) {
          result[js] = "transaction.hash";
          continue;
        }

        if (
          "transaction.from" in result === false &&
          eq(event.event.transaction.from, value)
        ) {
          result[js] = "transaction.from";
          continue;
        }

        if (
          "transaction.to" in result === false &&
          eq(event.event.transaction.to, value)
        ) {
          result[js] = "transaction.to";
          continue;
        }

        if (
          "transaction.transactionIndex" in result === false &&
          eq(event.event.transaction.transactionIndex, value)
        ) {
          result[js] = "transaction.transactionIndex";
          continue;
        }

        if (
          "transactionReceipt.contractAddress" in result === false &&
          eq(event.event.transactionReceipt?.contractAddress, value)
        ) {
          result[js] = "transactionReceipt.contractAddress";
          continue;
        }

        break;
      }

      case "log": {
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (`args.${argKey}` in result === false && eq(argValue, value)) {
            result[js] = `args.${argKey}`;
          }
        }

        if (result[js]) continue;

        if (
          "log.address" in result === false &&
          eq(event.event.log.address, value)
        ) {
          result[js] = "log.address";
          continue;
        }

        if (
          "log.logIndex" in result === false &&
          eq(event.event.log.logIndex, value)
        ) {
          result[js] = "log.logIndex";
          continue;
        }

        if (
          "block.hash" in result === false &&
          eq(event.event.block.hash, value)
        ) {
          result[js] = "block.hash";
          continue;
        }

        if (
          "block.number" in result === false &&
          eq(event.event.block.number, value)
        ) {
          result[js] = "block.number";
          continue;
        }

        if (
          "block.timestamp" in result === false &&
          eq(event.event.block.timestamp, value)
        ) {
          result[js] = "block.timestamp";
          continue;
        }

        if (
          "block.miner" in result === false &&
          eq(event.event.block.miner, value)
        ) {
          result[js] = "block.miner";
          continue;
        }

        if (
          "transaction.hash" in result === false &&
          eq(event.event.transaction.hash, value)
        ) {
          result[js] = "transaction.hash";
          continue;
        }

        if (
          "transaction.from" in result === false &&
          eq(event.event.transaction.from, value)
        ) {
          result[js] = "transaction.from";
          continue;
        }

        if (
          "transaction.to" in result === false &&
          eq(event.event.transaction.to, value)
        ) {
          result[js] = "transaction.to";
          continue;
        }

        if (
          "transaction.transactionIndex" in result === false &&
          eq(event.event.transaction.transactionIndex, value)
        ) {
          result[js] = "transaction.transactionIndex";
          continue;
        }

        if (
          "transactionReceipt.contractAddress" in result === false &&
          eq(event.event.transactionReceipt?.contractAddress, value)
        ) {
          result[js] = "transactionReceipt.contractAddress";
          continue;
        }

        break;
      }

      case "trace": {
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (`args.${argKey}` in result === false && eq(argValue, value)) {
            result[js] = `args.${argKey}`;
          }
        }

        if (result[js]) continue;

        if (
          "trace.from" in result === false &&
          eq(event.event.trace.from, value)
        ) {
          result[js] = "trace.from";
          continue;
        }

        if (
          "block.hash" in result === false &&
          eq(event.event.block.hash, value)
        ) {
          result[js] = "block.hash";
          continue;
        }

        if (
          "block.number" in result === false &&
          eq(event.event.block.number, value)
        ) {
          result[js] = "block.number";
          continue;
        }

        if (
          "block.timestamp" in result === false &&
          eq(event.event.block.timestamp, value)
        ) {
          result[js] = "block.timestamp";
          continue;
        }

        if (
          "block.miner" in result === false &&
          eq(event.event.block.miner, value)
        ) {
          result[js] = "block.miner";
          continue;
        }

        if (
          "transaction.hash" in result === false &&
          eq(event.event.transaction.hash, value)
        ) {
          result[js] = "transaction.hash";
          continue;
        }

        if (
          "transaction.from" in result === false &&
          eq(event.event.transaction.from, value)
        ) {
          result[js] = "transaction.from";
          continue;
        }

        if (
          "transaction.to" in result === false &&
          eq(event.event.transaction.to, value)
        ) {
          result[js] = "transaction.to";
          continue;
        }

        if (
          "transaction.transactionIndex" in result === false &&
          eq(event.event.transaction.transactionIndex, value)
        ) {
          result[js] = "transaction.transactionIndex";
          continue;
        }

        if (
          "transactionReceipt.contractAddress" in result === false &&
          eq(event.event.transactionReceipt?.contractAddress, value)
        ) {
          result[js] = "transactionReceipt.contractAddress";
          continue;
        }

        break;
      }

      case "transfer": {
        if (
          "transfer.from" in result === false &&
          eq(event.event.transfer.from, value)
        ) {
          result[js] = "transfer.from";
          continue;
        }

        if (
          "transfer.to" in result === false &&
          eq(event.event.transfer.to, value)
        ) {
          result[js] = "transfer.to";
          continue;
        }

        if (
          "trace.from" in result === false &&
          eq(event.event.trace.from, value)
        ) {
          result[js] = "trace.from";
          continue;
        }

        if (
          "block.hash" in result === false &&
          eq(event.event.block.hash, value)
        ) {
          result[js] = "block.hash";
          continue;
        }

        if (
          "block.number" in result === false &&
          eq(event.event.block.number, value)
        ) {
          result[js] = "block.number";
          continue;
        }

        if (
          "block.timestamp" in result === false &&
          eq(event.event.block.timestamp, value)
        ) {
          result[js] = "block.timestamp";
          continue;
        }

        if (
          "block.miner" in result === false &&
          eq(event.event.block.miner, value)
        ) {
          result[js] = "block.miner";
          continue;
        }

        if (
          "transaction.hash" in result === false &&
          eq(event.event.transaction.hash, value)
        ) {
          result[js] = "transaction.hash";
          continue;
        }

        if (
          "transaction.from" in result === false &&
          eq(event.event.transaction.from, value)
        ) {
          result[js] = "transaction.from";
          continue;
        }

        if (
          "transaction.to" in result === false &&
          eq(event.event.transaction.to, value)
        ) {
          result[js] = "transaction.to";
          continue;
        }

        if (
          "transaction.transactionIndex" in result === false &&
          eq(event.event.transaction.transactionIndex, value)
        ) {
          result[js] = "transaction.transactionIndex";
          continue;
        }

        if (
          "transactionReceipt.contractAddress" in result === false &&
          eq(event.event.transactionReceipt?.contractAddress, value)
        ) {
          result[js] = "transactionReceipt.contractAddress";
          continue;
        }

        break;
      }
    }
    return undefined;
  }

  return result;
};

export const getAccess = <T extends object>(
  base: T,
  access: (keyof T | unknown)[],
): unknown => {
  if (access.length === 0) return base;
  const a = access.splice(0, 1);
  // @ts-ignore
  return getAccess(base[a]!, access);
};
