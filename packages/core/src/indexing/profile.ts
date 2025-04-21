import type { Event } from "@/internal/types.js";
import { orderObject } from "@/utils/order.js";
import type { Abi } from "viem";
import type { PonderActions, ProfilePattern, Request } from "./client.js";

export const getProfilePatternKey = (pattern: ProfilePattern): string => {
  return JSON.stringify(
    orderObject({
      address: pattern.address,
      functionName: pattern.functionName,
      args: pattern.args,
    }),
    (_, value) => {
      if (typeof value === "bigint") {
        return value.toString();
      }
      return value;
    },
  );
};

const eq = (target: bigint | string | number | boolean, value: any) => {
  if (target === value) return true;
  if (target && value && target.toString() === value.toString()) return true;
  return false;
};

export const recordProfilePattern = ({
  event,
  args,
  hints,
}: {
  event: Event;
  args: Omit<
    Parameters<PonderActions["readContract"]>[0],
    "blockNumber" | "cache"
  >;
  hints: { pattern: ProfilePattern; hasConstant: boolean }[];
}): { pattern: ProfilePattern; hasConstant: boolean } | undefined => {
  for (const hint of hints) {
    const request = recoverProfilePattern(hint.pattern, event);
    if (
      request.functionName === args.functionName &&
      request.address === args.address
    ) {
      if (request.args === undefined && args.args === undefined) return hint;
      if (request.args === undefined || args.args === undefined) continue;
      for (let i = 0; i < request.args.length; i++) {
        if (eq(request.args[i] as any, args.args[i]) === false) continue;
      }

      return hint;
    }
  }

  let resultAddress: ProfilePattern["address"] | undefined;
  let hasConstant = false;

  // address

  switch (event.type) {
    case "block": {
      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: ["block", "miner"] };
        break;
      }

      break;
    }

    case "transaction": {
      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: ["block", "miner"] };
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = { type: "derived", value: ["transaction", "from"] };
        break;
      }

      if (
        event.event.transaction.to &&
        eq(event.event.transaction.to, args.address)
      ) {
        resultAddress = { type: "derived", value: ["transaction", "to"] };
        break;
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transactionReceipt", "contractAddress"],
        };
        break;
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

          if (typeof argValue !== "object" && eq(argValue, args.address)) {
            resultAddress = { type: "derived", value: ["args", argKey] };
            hasMatch = true;
            break;
          }
        }

        if (hasMatch) break;
      }

      if (eq(event.event.log.address, args.address)) {
        resultAddress = { type: "derived", value: ["log", "address"] };
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: ["block", "miner"] };
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = { type: "derived", value: ["transaction", "from"] };
        break;
      }

      if (
        event.event.transaction.to &&
        eq(event.event.transaction.to, args.address)
      ) {
        resultAddress = { type: "derived", value: ["transaction", "to"] };
        break;
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transactionReceipt", "contractAddress"],
        };
        break;
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

          if (typeof argValue !== "object" && eq(argValue, args.address)) {
            resultAddress = { type: "derived", value: ["args", argKey] };
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

          if (typeof argValue !== "object" && eq(argValue, args.address)) {
            resultAddress = { type: "derived", value: ["result", argKey] };
            hasMatch = true;
            break;
          }
        }
      }

      if (hasMatch) break;

      if (eq(event.event.trace.from, args.address)) {
        resultAddress = { type: "derived", value: ["trace", "from"] };
        break;
      }

      if (event.event.trace.to && eq(event.event.trace.to, args.address)) {
        resultAddress = { type: "derived", value: ["trace", "to"] };
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: ["block", "miner"] };
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = { type: "derived", value: ["transaction", "from"] };
        break;
      }

      if (
        event.event.transaction.to &&
        eq(event.event.transaction.to, args.address)
      ) {
        resultAddress = { type: "derived", value: ["transaction", "to"] };
        break;
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transactionReceipt", "contractAddress"],
        };
        break;
      }

      break;
    }

    case "transfer": {
      if (eq(event.event.transfer.from, args.address)) {
        resultAddress = { type: "derived", value: ["transfer", "from"] };
        break;
      }

      if (eq(event.event.transfer.to, args.address)) {
        resultAddress = { type: "derived", value: ["transfer", "to"] };
        break;
      }

      if (eq(event.event.trace.from, args.address)) {
        resultAddress = { type: "derived", value: ["trace", "from"] };
        break;
      }

      if (event.event.trace.to && eq(event.event.trace.to, args.address)) {
        resultAddress = { type: "derived", value: ["trace", "to"] };
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: ["block", "miner"] };
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = { type: "derived", value: ["transaction", "from"] };
        break;
      }

      if (
        event.event.transaction.to &&
        eq(event.event.transaction.to, args.address)
      ) {
        resultAddress = { type: "derived", value: ["transaction", "to"] };
        break;
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: ["transactionReceipt", "contractAddress"],
        };
        break;
      }

      break;
    }
  }

  if (resultAddress === undefined) {
    resultAddress = { type: "constant", value: args.address };
    hasConstant = true;
  }

  if (args.args === undefined || args.args.length === 0) {
    return {
      pattern: {
        address: resultAddress,
        abi: args.abi as Abi,
        functionName: args.functionName,
        args: undefined,
      },
      hasConstant,
    };
  }

  const resultArgs: NonNullable<ProfilePattern["args"]> = [];

  // args

  for (const arg of args.args) {
    if (typeof arg === "object") {
      return undefined;
    }

    switch (event.type) {
      case "block": {
        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "miner"] });
          continue;
        }

        break;
      }

      case "transaction": {
        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "miner"] });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "hash"] });
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "from"] });
          continue;
        }

        if (event.event.transaction.to && eq(event.event.transaction.to, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "to"] });
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "transactionIndex"],
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transactionReceipt", "contractAddress"],
          });
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

            if (typeof argValue !== "object" && eq(argValue, arg)) {
              resultArgs.push({ type: "derived", value: ["args", argKey] });
              hasMatch = true;
              break;
            }
          }

          if (hasMatch) continue;
        }

        if (eq(event.event.log.address, arg)) {
          resultArgs.push({ type: "derived", value: ["log", "address"] });
          continue;
        }

        if (eq(event.event.log.logIndex, arg)) {
          resultArgs.push({ type: "derived", value: ["log", "logIndex"] });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "miner"] });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "hash"] });
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "from"] });
          continue;
        }

        if (event.event.transaction.to && eq(event.event.transaction.to, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "to"] });
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "transactionIndex"],
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transactionReceipt", "contractAddress"],
          });
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

            if (typeof argValue !== "object" && eq(argValue, arg)) {
              resultArgs.push({ type: "derived", value: ["args", argKey] });
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

            if (typeof argValue !== "object" && eq(argValue, arg)) {
              resultArgs.push({ type: "derived", value: ["result", argKey] });
              hasMatch = true;
              break;
            }
          }
        }

        if (hasMatch) continue;

        if (eq(event.event.trace.from, arg)) {
          resultArgs.push({ type: "derived", value: ["trace", "from"] });
          continue;
        }

        if (event.event.trace.to && eq(event.event.trace.to, arg)) {
          resultArgs.push({ type: "derived", value: ["trace", "to"] });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "miner"] });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "hash"] });
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "from"] });
          continue;
        }

        if (event.event.transaction.to && eq(event.event.transaction.to, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "to"] });
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "transactionIndex"],
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transactionReceipt", "contractAddress"],
          });
          continue;
        }

        break;
      }

      case "transfer": {
        if (eq(event.event.transfer.from, arg)) {
          resultArgs.push({ type: "derived", value: ["transfer", "from"] });
          continue;
        }

        if (eq(event.event.transfer.to, arg)) {
          resultArgs.push({ type: "derived", value: ["transfer", "to"] });
          continue;
        }

        if (eq(event.event.trace.from, arg)) {
          resultArgs.push({ type: "derived", value: ["trace", "from"] });
          continue;
        }

        if (event.event.trace.to && eq(event.event.trace.to, arg)) {
          resultArgs.push({ type: "derived", value: ["trace", "to"] });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "hash"] });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "number"] });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "timestamp"] });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: ["block", "miner"] });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "hash"] });
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "from"] });
          continue;
        }

        if (event.event.transaction.to && eq(event.event.transaction.to, arg)) {
          resultArgs.push({ type: "derived", value: ["transaction", "to"] });
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: ["transaction", "transactionIndex"],
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: ["transactionReceipt", "contractAddress"],
          });
          continue;
        }

        break;
      }
    }

    resultArgs.push({ type: "constant", value: arg });
    hasConstant = true;
  }

  return {
    pattern: {
      address: resultAddress!,
      abi: args.abi as Abi,
      functionName: args.functionName,
      args: resultArgs,
    },
    hasConstant,
  };
};

export const recoverProfilePattern = (
  pattern: ProfilePattern,
  event: Event,
): Request => {
  let address: `0x${string}`;

  if (pattern.address.type === "constant") {
    address = pattern.address.value as `0x${string}`;
  } else {
    let _result: unknown = event.event;
    for (const prop of pattern.address.value) {
      // @ts-ignore
      _result = _result[prop];
    }
    address = _result as `0x${string}`;
  }

  let args: unknown[] | undefined;
  if (pattern.args) {
    args = [];
    for (const arg of pattern.args) {
      if (arg.type === "constant") {
        args.push(arg.value);
      } else {
        let _result: unknown = event.event;
        for (const prop of arg.value) {
          // @ts-ignore
          _result = _result[prop];
        }
        args.push(_result);
      }
    }
  }

  return {
    address,
    abi: pattern.abi,
    functionName: pattern.functionName,
    args,
    blockNumber: event.event.block.number,
    chainId: event.chainId,
  };
};
