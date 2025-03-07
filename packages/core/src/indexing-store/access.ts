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

    if (eq(event.chainId, value)) {
      result[js] = "chainId";
      continue;
    }

    if (eq(event.event.id, value)) {
      result[js] = "id";
      continue;
    }

    switch (event.type) {
      case "block": {
        if (eq(event.event.block.hash, value)) {
          result[js] = "block.hash";
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = "block.number";
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = "block.timestamp";
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = "block.miner";
          continue;
        }

        break;
      }

      case "transaction": {
        if (eq(event.event.block.hash, value)) {
          result[js] = "block.hash";
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = "block.number";
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = "block.timestamp";
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = "block.miner";
          continue;
        }

        if (eq(event.event.transaction.hash, value)) {
          result[js] = "transaction.hash";
          continue;
        }

        if (eq(event.event.transaction.from, value)) {
          result[js] = "transaction.from";
          continue;
        }

        if (eq(event.event.transaction.to, value)) {
          result[js] = "transaction.to";
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, value)) {
          result[js] = "transaction.transactionIndex";
          continue;
        }

        if (eq(event.event.transactionReceipt?.contractAddress, value)) {
          result[js] = "transactionReceipt.contractAddress";
          continue;
        }

        break;
      }

      case "log": {
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (eq(argValue, value)) {
            result[js] = `args.${argKey}`;
          }
        }

        if (result[js]) continue;

        if (eq(event.event.log.address, value)) {
          result[js] = "log.address";
          continue;
        }

        if (eq(event.event.log.logIndex, value)) {
          result[js] = "log.logIndex";
          continue;
        }

        if (eq(event.event.block.hash, value)) {
          result[js] = "block.hash";
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = "block.number";
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = "block.timestamp";
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = "block.miner";
          continue;
        }

        if (eq(event.event.transaction.hash, value)) {
          result[js] = "transaction.hash";
          continue;
        }

        if (eq(event.event.transaction.from, value)) {
          result[js] = "transaction.from";
          continue;
        }

        if (eq(event.event.transaction.to, value)) {
          result[js] = "transaction.to";
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, value)) {
          result[js] = "transaction.transactionIndex";
          continue;
        }

        if (eq(event.event.transactionReceipt?.contractAddress, value)) {
          result[js] = "transactionReceipt.contractAddress";
          continue;
        }

        break;
      }

      case "trace": {
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (argValue === value) {
            result[js] = `args.${argKey}`;
          }
        }

        if (result[js]) continue;

        if (eq(event.event.trace.from, value)) {
          result[js] = "trace.from";
          continue;
        }

        if (eq(event.event.block.hash, value)) {
          result[js] = "block.hash";
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = "block.number";
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = "block.timestamp";
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = "block.miner";
          continue;
        }

        if (eq(event.event.transaction.hash, value)) {
          result[js] = "transaction.hash";
          continue;
        }

        if (eq(event.event.transaction.from, value)) {
          result[js] = "transaction.from";
          continue;
        }

        if (eq(event.event.transaction.to, value)) {
          result[js] = "transaction.to";
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, value)) {
          result[js] = "transaction.transactionIndex";
          continue;
        }

        if (eq(event.event.transactionReceipt?.contractAddress, value)) {
          result[js] = "transactionReceipt.contractAddress";
          continue;
        }

        break;
      }

      case "transfer": {
        if (eq(event.event.transfer.from, value)) {
          result[js] = "transfer.from";
          continue;
        }

        if (eq(event.event.transfer.to, value)) {
          result[js] = "transfer.to";
          continue;
        }

        if (eq(event.event.trace.from, value)) {
          result[js] = "trace.from";
          continue;
        }

        if (eq(event.event.block.hash, value)) {
          result[js] = "block.hash";
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = "block.number";
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = "block.timestamp";
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = "block.miner";
          continue;
        }

        if (eq(event.event.transaction.hash, value)) {
          result[js] = "transaction.hash";
          continue;
        }

        if (eq(event.event.transaction.from, value)) {
          result[js] = "transaction.from";
          continue;
        }

        if (eq(event.event.transaction.to, value)) {
          result[js] = "transaction.to";
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, value)) {
          result[js] = "transaction.transactionIndex";
          continue;
        }

        if (eq(event.event.transactionReceipt?.contractAddress, value)) {
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
