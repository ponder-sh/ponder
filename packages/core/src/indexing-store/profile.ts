import type { Event } from "@/internal/types.js";
import { orderObject } from "@/utils/order.js";
import type { Column, Table } from "drizzle-orm";
import type { ProfilePattern, Row } from "./cache.js";
import { getCacheKey } from "./utils.js";

export const getProfilePatternKey = (pattern: ProfilePattern): string => {
  return JSON.stringify(orderObject(pattern), (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  });
};

const eq = (target: bigint | string | number | boolean, value: any) => {
  if (target === value) return true;
  if (target && value && target.toString() === value.toString()) return true;
  return false;
};

export const recordProfilePattern = (
  event: Event,
  table: Table,
  key: object,
  hints: ProfilePattern[],
  cache: Map<Table, [string, Column][]>,
): ProfilePattern | undefined => {
  for (const hint of hints) {
    if (
      getCacheKey(table, key, cache) ===
      getCacheKey(table, recoverProfilePattern(hint, event), cache)
    ) {
      return hint;
    }
  }

  const result: ProfilePattern = {};

  for (const [js] of cache.get(table)!) {
    // @ts-ignore
    const value = key[js]!;

    if (eq(event.chainId, value)) {
      result[js] = ["chainId"];
      continue;
    }

    if (eq(event.event.id, value)) {
      result[js] = ["id"];
      continue;
    }

    switch (event.type) {
      case "block": {
        if (eq(event.event.block.hash, value)) {
          result[js] = ["block", "hash"];
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = ["block", "number"];
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = ["block", "timestamp"];
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = ["block", "miner"];
          continue;
        }

        break;
      }

      case "transaction": {
        if (eq(event.event.block.hash, value)) {
          result[js] = ["block", "hash"];
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = ["block", "number"];
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = ["block", "timestamp"];
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = ["block", "miner"];
          continue;
        }

        if (eq(event.event.transaction.hash, value)) {
          result[js] = ["transaction", "hash"];
          continue;
        }

        if (eq(event.event.transaction.from, value)) {
          result[js] = ["transaction", "from"];
          continue;
        }

        if (
          event.event.transaction.to &&
          eq(event.event.transaction.to, value)
        ) {
          result[js] = ["transaction", "to"];
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, value)) {
          result[js] = ["transaction", "transactionIndex"];
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, value)
        ) {
          result[js] = ["transactionReceipt", "contractAddress"];
          continue;
        }

        break;
      }

      case "log": {
        // Note: explicitly skip profiling args if they are an array
        if (
          event.event.args !== undefined &&
          Array.isArray(event.event.args) === false
        ) {
          let hasMatch = false;
          for (const argKey of Object.keys(event.event.args)) {
            const argValue = (event.event.args as { [key: string]: unknown })[
              argKey
            ] as string | bigint | number | boolean;

            if (typeof argValue !== "object" && eq(argValue, value)) {
              result[js] = ["args", argKey];
              hasMatch = true;
              break;
            }
          }

          if (hasMatch) continue;
        }

        if (eq(event.event.log.address, value)) {
          result[js] = ["log", "address"];
          continue;
        }

        if (eq(event.event.log.logIndex, value)) {
          result[js] = ["log", "logIndex"];
          continue;
        }

        if (eq(event.event.block.hash, value)) {
          result[js] = ["block", "hash"];
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = ["block", "number"];
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = ["block", "timestamp"];
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = ["block", "miner"];
          continue;
        }

        if (eq(event.event.transaction.hash, value)) {
          result[js] = ["transaction", "hash"];
          continue;
        }

        if (eq(event.event.transaction.from, value)) {
          result[js] = ["transaction", "from"];
          continue;
        }

        if (
          event.event.transaction.to &&
          eq(event.event.transaction.to, value)
        ) {
          result[js] = ["transaction", "to"];
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, value)) {
          result[js] = ["transaction", "transactionIndex"];
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, value)
        ) {
          result[js] = ["transactionReceipt", "contractAddress"];
          continue;
        }

        break;
      }

      case "trace": {
        let hasMatch = false;

        // Note: explicitly skip profiling args if they are an array
        if (
          event.event.args !== undefined &&
          Array.isArray(event.event.args) === false
        ) {
          for (const argKey of Object.keys(event.event.args)) {
            const argValue = (event.event.args as { [key: string]: unknown })[
              argKey
            ] as string | bigint | number | boolean;

            if (typeof argValue !== "object" && eq(argValue, value)) {
              result[js] = ["args", argKey];
              hasMatch = true;
              break;
            }
          }
        }

        // Note: explicitly skip profiling result if it is an array
        if (
          event.event.result !== undefined &&
          Array.isArray(event.event.result) === false
        ) {
          for (const argKey of Object.keys(event.event.result)) {
            const argValue = (event.event.result as { [key: string]: unknown })[
              argKey
            ] as string | bigint | number | boolean;

            if (typeof argValue !== "object" && eq(argValue, value)) {
              result[js] = ["result", argKey];
              hasMatch = true;
              break;
            }
          }
        }

        if (hasMatch) continue;

        if (eq(event.event.trace.from, value)) {
          result[js] = ["trace", "from"];
          continue;
        }

        if (event.event.trace.to && eq(event.event.trace.to, value)) {
          result[js] = ["trace", "to"];
          continue;
        }

        if (eq(event.event.block.hash, value)) {
          result[js] = ["block", "hash"];
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = ["block", "number"];
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = ["block", "timestamp"];
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = ["block", "miner"];
          continue;
        }

        if (eq(event.event.transaction.hash, value)) {
          result[js] = ["transaction", "hash"];
          continue;
        }

        if (eq(event.event.transaction.from, value)) {
          result[js] = ["transaction", "from"];
          continue;
        }

        if (
          event.event.transaction.to &&
          eq(event.event.transaction.to, value)
        ) {
          result[js] = ["transaction", "to"];
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, value)) {
          result[js] = ["transaction", "transactionIndex"];
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, value)
        ) {
          result[js] = ["transactionReceipt", "contractAddress"];
          continue;
        }

        break;
      }

      case "transfer": {
        if (eq(event.event.transfer.from, value)) {
          result[js] = ["transfer", "from"];
          continue;
        }

        if (eq(event.event.transfer.to, value)) {
          result[js] = ["transfer", "to"];
          continue;
        }

        if (eq(event.event.trace.from, value)) {
          result[js] = ["trace", "from"];
          continue;
        }

        if (event.event.trace.to && eq(event.event.trace.to, value)) {
          result[js] = ["trace", "to"];
          continue;
        }

        if (eq(event.event.block.hash, value)) {
          result[js] = ["block", "hash"];
          continue;
        }

        if (eq(event.event.block.number, value)) {
          result[js] = ["block", "number"];
          continue;
        }

        if (eq(event.event.block.timestamp, value)) {
          result[js] = ["block", "timestamp"];
          continue;
        }

        if (eq(event.event.block.miner, value)) {
          result[js] = ["block", "miner"];
          continue;
        }

        if (eq(event.event.transaction.hash, value)) {
          result[js] = ["transaction", "hash"];
          continue;
        }

        if (eq(event.event.transaction.from, value)) {
          result[js] = ["transaction", "from"];
          continue;
        }

        if (
          event.event.transaction.to &&
          eq(event.event.transaction.to, value)
        ) {
          result[js] = ["transaction", "to"];
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, value)) {
          result[js] = ["transaction", "transactionIndex"];
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, value)
        ) {
          result[js] = ["transactionReceipt", "contractAddress"];
          continue;
        }

        break;
      }
    }
    return undefined;
  }

  return result;
};

export const recoverProfilePattern = (
  pattern: ProfilePattern,
  event: Event,
): Row => {
  const result: Row = {};

  for (const [key, value] of Object.entries(pattern)) {
    if (value[0] === "chainId") {
      result[key] = event.chainId;
    } else {
      let _result: unknown = event.event;
      for (const prop of value) {
        // @ts-ignore
        _result = _result[prop];
      }
      result[key] = _result;
    }
  }

  return result;
};
