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

const delimiters = ["-", "_", ":", "#", "$"];

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

    const pattern = matchEventParameters(event, value);

    if (pattern === undefined) return undefined;

    result[js] = pattern;
  }

  return result;
};

const matchEventParameters = (
  event: Event,
  value: any,
): ProfilePattern["string"] | undefined => {
  if (eq(event.chainId, value)) {
    return { value: ["chainId"] };
  }

  if (eq(event.event.id, value)) {
    return { value: ["id"] };
  }

  switch (event.type) {
    case "block": {
      if (eq(event.event.block.hash, value)) {
        return { value: ["block", "hash"] };
      }

      if (eq(event.event.block.number, value)) {
        return { value: ["block", "number"] };
      }

      if (eq(event.event.block.timestamp, value)) {
        return { value: ["block", "timestamp"] };
      }

      if (eq(event.event.block.timestamp / 60n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 60n,
        };
      }

      if (eq(event.event.block.timestamp / 3600n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 3600n,
        };
      }

      if (eq(event.event.block.timestamp / 86400n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 86400n,
        };
      }

      if (eq(event.event.block.miner, value)) {
        return { value: ["block", "miner"] };
      }

      break;
    }

    case "transaction": {
      if (eq(event.event.block.hash, value)) {
        return { value: ["block", "hash"] };
      }

      if (eq(event.event.block.number, value)) {
        return { value: ["block", "number"] };
      }

      if (eq(event.event.block.timestamp, value)) {
        return { value: ["block", "timestamp"] };
      }

      if (eq(event.event.block.timestamp / 60n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 60n,
        };
      }

      if (eq(event.event.block.timestamp / 3600n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 3600n,
        };
      }

      if (eq(event.event.block.timestamp / 86400n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 86400n,
        };
      }

      if (eq(event.event.block.miner, value)) {
        return { value: ["block", "miner"] };
      }

      if (eq(event.event.transaction.hash, value)) {
        return { value: ["transaction", "hash"] };
      }

      if (eq(event.event.transaction.from, value)) {
        return { value: ["transaction", "from"] };
      }

      if (event.event.transaction.to && eq(event.event.transaction.to, value)) {
        return { value: ["transaction", "to"] };
      }

      if (eq(event.event.transaction.transactionIndex, value)) {
        return { value: ["transaction", "transactionIndex"] };
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, value)
      ) {
        return { value: ["transactionReceipt", "contractAddress"] };
      }

      break;
    }

    case "log": {
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
            return { value: ["args", argKey] };
          }
        }
      }

      if (eq(event.event.log.address, value)) {
        return { value: ["log", "address"] };
      }

      if (eq(event.event.log.logIndex, value)) {
        return { value: ["log", "logIndex"] };
      }

      if (eq(event.event.block.hash, value)) {
        return { value: ["block", "hash"] };
      }

      if (eq(event.event.block.number, value)) {
        return { value: ["block", "number"] };
      }

      if (eq(event.event.block.timestamp, value)) {
        return { value: ["block", "timestamp"] };
      }

      if (eq(event.event.block.timestamp / 60n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 60n,
        };
      }

      if (eq(event.event.block.timestamp / 3600n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 3600n,
        };
      }

      if (eq(event.event.block.timestamp / 86400n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 86400n,
        };
      }

      if (eq(event.event.block.miner, value)) {
        return { value: ["block", "miner"] };
      }

      if (eq(event.event.transaction.hash, value)) {
        return { value: ["transaction", "hash"] };
      }

      if (eq(event.event.transaction.from, value)) {
        return { value: ["transaction", "from"] };
      }

      if (event.event.transaction.to && eq(event.event.transaction.to, value)) {
        return { value: ["transaction", "to"] };
      }

      if (eq(event.event.transaction.transactionIndex, value)) {
        return { value: ["transaction", "transactionIndex"] };
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, value)
      ) {
        return { value: ["transactionReceipt", "contractAddress"] };
      }

      break;
    }

    case "trace": {
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
            return { value: ["args", argKey] };
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
            return { value: ["result", argKey] };
          }
        }
      }

      if (eq(event.event.trace.from, value)) {
        return { value: ["trace", "from"] };
      }

      if (event.event.trace.to && eq(event.event.trace.to, value)) {
        return { value: ["trace", "to"] };
      }

      if (eq(event.event.block.hash, value)) {
        return { value: ["block", "hash"] };
      }

      if (eq(event.event.block.number, value)) {
        return { value: ["block", "number"] };
      }

      if (eq(event.event.block.timestamp, value)) {
        return { value: ["block", "timestamp"] };
      }

      if (eq(event.event.block.timestamp / 60n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 60n,
        };
      }

      if (eq(event.event.block.timestamp / 3600n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 3600n,
        };
      }

      if (eq(event.event.block.timestamp / 86400n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 86400n,
        };
      }

      if (eq(event.event.block.miner, value)) {
        return { value: ["block", "miner"] };
      }

      if (eq(event.event.transaction.hash, value)) {
        return { value: ["transaction", "hash"] };
      }

      if (eq(event.event.transaction.from, value)) {
        return { value: ["transaction", "from"] };
      }

      if (event.event.transaction.to && eq(event.event.transaction.to, value)) {
        return { value: ["transaction", "to"] };
      }

      if (eq(event.event.transaction.transactionIndex, value)) {
        return { value: ["transaction", "transactionIndex"] };
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, value)
      ) {
        return { value: ["transactionReceipt", "contractAddress"] };
      }

      break;
    }

    case "transfer": {
      if (eq(event.event.transfer.from, value)) {
        return { value: ["transfer", "from"] };
      }

      if (eq(event.event.transfer.to, value)) {
        return { value: ["transfer", "to"] };
      }

      if (eq(event.event.trace.from, value)) {
        return { value: ["trace", "from"] };
      }

      if (event.event.trace.to && eq(event.event.trace.to, value)) {
        return { value: ["trace", "to"] };
      }

      if (eq(event.event.block.hash, value)) {
        return { value: ["block", "hash"] };
      }

      if (eq(event.event.block.number, value)) {
        return { value: ["block", "number"] };
      }

      if (eq(event.event.block.timestamp, value)) {
        return { value: ["block", "timestamp"] };
      }

      if (eq(event.event.block.timestamp / 60n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 60n,
        };
      }

      if (eq(event.event.block.timestamp / 3600n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 3600n,
        };
      }

      if (eq(event.event.block.timestamp / 86400n, value)) {
        return {
          value: ["block", "timestamp"],
          fn: (value) => (value as bigint) / 86400n,
        };
      }

      if (eq(event.event.block.miner, value)) {
        return { value: ["block", "miner"] };
      }

      if (eq(event.event.transaction.hash, value)) {
        return { value: ["transaction", "hash"] };
      }

      if (eq(event.event.transaction.from, value)) {
        return { value: ["transaction", "from"] };
      }

      if (event.event.transaction.to && eq(event.event.transaction.to, value)) {
        return { value: ["transaction", "to"] };
      }

      if (eq(event.event.transaction.transactionIndex, value)) {
        return { value: ["transaction", "transactionIndex"] };
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, value)
      ) {
        return { value: ["transactionReceipt", "contractAddress"] };
      }

      break;
    }
  }

  if (typeof value === "string") {
    del: for (const delimiter of delimiters) {
      const subValues = value.split(delimiter);
      if (subValues.length > 1) {
        const result = {
          values: [] as any,
          delimiter,
        };

        for (const subValue of subValues) {
          const match = matchEventParameters(event, subValue);
          if (match !== undefined && "value" in match) {
            result.values.push(match);
            continue;
          }

          continue del;
        }

        return result;
      }
    }
  }

  return undefined;
};

export const recoverProfilePattern = (
  pattern: ProfilePattern,
  event: Event,
): Row => {
  const result: Row = {};

  for (const [key, _value] of Object.entries(pattern)) {
    if ("fn" in _value) {
      const { value, fn } = _value;

      if (value[0] === "chainId") {
        result[key] = event.chainId;
      } else {
        let _result: unknown = event.event;
        for (const prop of value) {
          // @ts-ignore
          _result = _result[prop];
        }

        if (fn) {
          _result = fn(_result);
        }

        result[key] = _result;
      }
    }

    if ("delimiter" in _value) {
      const { values, delimiter } = _value;

      result[key] = values
        .map(({ value, fn }) => {
          if (value[0] === "chainId") {
            return event.chainId;
          } else {
            let _result: unknown = event.event;
            for (const prop of value) {
              // @ts-ignore
              _result = _result[prop];
            }

            if (fn) {
              _result = fn(_result);
            }

            return _result;
          }
        })
        .join(delimiter);
    }
  }

  return result;
};
