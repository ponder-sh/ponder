import type { Event } from "@/internal/types.js";
import type { Abi } from "viem";
import {
  type PonderActions,
  type ProfilePattern,
  type Request,
  encodeRequest,
  getCacheKey,
} from "./client.js";

export const getProfilePatternKey = (pattern: ProfilePattern): string => {
  return JSON.stringify(pattern, (key, value) => {
    if (key === "abi") return undefined;

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
}): { pattern: ProfilePattern; hasConstant: boolean } => {
  for (const hint of hints) {
    if (
      getCacheKey(
        encodeRequest({
          address: args.address,
          abi: args.abi as Abi,
          functionName: args.functionName,
          args: args.args,
          blockNumber: event.event.block.number,
          chainId: event.chainId,
        }),
      ) ===
      getCacheKey(encodeRequest(recoverProfilePattern(hint.pattern, event)))
    ) {
      return hint;
    }
  }

  let resultAddress: ProfilePattern["address"] | undefined;
  let hasConstant = false;

  // address

  switch (event.type) {
    case "block": {
      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: "block.miner" };
        break;
      }

      break;
    }

    case "transaction": {
      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: "block.miner" };
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = { type: "derived", value: "transaction.from" };
        break;
      }

      if (
        event.event.transaction.to &&
        eq(event.event.transaction.to, args.address)
      ) {
        resultAddress = { type: "derived", value: "transaction.to" };
        break;
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: "transactionReceipt.contractAddress",
        };
        break;
      }

      break;
    }

    case "log": {
      let hasMatch = false;
      for (const argKey of Object.keys(event.event.args)) {
        const argValue = event.event.args[argKey];

        if (eq(argValue, args.address)) {
          resultAddress = { type: "derived", value: `args.${argKey}` };
          hasMatch = true;
          break;
        }
      }

      if (hasMatch) break;

      if (eq(event.event.log.address, args.address)) {
        resultAddress = { type: "derived", value: "log.address" };
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: "block.miner" };
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = { type: "derived", value: "transaction.from" };
        break;
      }

      if (
        event.event.transaction.to &&
        eq(event.event.transaction.to, args.address)
      ) {
        resultAddress = { type: "derived", value: "transaction.to" };
        break;
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: "transactionReceipt.contractAddress",
        };
        break;
      }

      break;
    }

    case "trace": {
      let hasMatch = false;
      for (const argKey of Object.keys(event.event.args)) {
        const argValue = event.event.args[argKey];

        if (eq(argValue, args.address)) {
          resultAddress = { type: "derived", value: `args.${argKey}` };
          hasMatch = true;
          break;
        }
      }

      if (hasMatch) break;

      if (eq(event.event.trace.from, args.address)) {
        resultAddress = { type: "derived", value: "trace.from" };
        break;
      }

      if (event.event.trace.to && eq(event.event.trace.to, args.address)) {
        resultAddress = { type: "derived", value: "trace.to" };
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: "block.miner" };
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = { type: "derived", value: "transaction.from" };
        break;
      }

      if (
        event.event.transaction.to &&
        eq(event.event.transaction.to, args.address)
      ) {
        resultAddress = { type: "derived", value: "transaction.to" };
        break;
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: "transactionReceipt.contractAddress",
        };
        break;
      }

      break;
    }

    case "transfer": {
      if (eq(event.event.transfer.from, args.address)) {
        resultAddress = { type: "derived", value: "transfer.from" };
        break;
      }

      if (eq(event.event.transfer.to, args.address)) {
        resultAddress = { type: "derived", value: "transfer.to" };
        break;
      }

      if (eq(event.event.trace.from, args.address)) {
        resultAddress = { type: "derived", value: "trace.from" };
        break;
      }

      if (event.event.trace.to && eq(event.event.trace.to, args.address)) {
        resultAddress = { type: "derived", value: "trace.to" };
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = { type: "derived", value: "block.miner" };
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = { type: "derived", value: "transaction.from" };
        break;
      }

      if (
        event.event.transaction.to &&
        eq(event.event.transaction.to, args.address)
      ) {
        resultAddress = { type: "derived", value: "transaction.to" };
        break;
      }

      if (
        event.event.transactionReceipt?.contractAddress &&
        eq(event.event.transactionReceipt.contractAddress, args.address)
      ) {
        resultAddress = {
          type: "derived",
          value: "transactionReceipt.contractAddress",
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
    switch (event.type) {
      case "block": {
        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: "block.hash" });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: "block.number" });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: "block.timestamp" });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: "block.miner" });
          continue;
        }

        break;
      }

      case "transaction": {
        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: "block.hash" });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: "block.number" });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: "block.timestamp" });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: "block.miner" });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.hash" });
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.from" });
          continue;
        }

        if (event.event.transaction.to && eq(event.event.transaction.to, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.to" });
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: "transaction.transactionIndex",
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: "transactionReceipt.contractAddress",
          });
          continue;
        }

        break;
      }

      case "log": {
        let hasMatch = false;
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (eq(argValue, arg)) {
            resultArgs.push({ type: "derived", value: `args.${argKey}` });
            hasMatch = true;
            break;
          }
        }

        if (hasMatch) continue;

        if (eq(event.event.log.address, arg)) {
          resultArgs.push({ type: "derived", value: "log.address" });
          continue;
        }

        if (eq(event.event.log.logIndex, arg)) {
          resultArgs.push({ type: "derived", value: "log.logIndex" });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: "block.hash" });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: "block.number" });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: "block.timestamp" });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: "block.miner" });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.hash" });
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.from" });
          continue;
        }

        if (event.event.transaction.to && eq(event.event.transaction.to, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.to" });
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: "transaction.transactionIndex",
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: "transactionReceipt.contractAddress",
          });
          continue;
        }

        break;
      }

      case "trace": {
        let hasMatch = false;
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (eq(argValue, arg)) {
            resultArgs.push({ type: "derived", value: `args.${argKey}` });
            hasMatch = true;
            break;
          }
        }

        if (hasMatch) continue;

        if (eq(event.event.trace.from, arg)) {
          resultArgs.push({ type: "derived", value: "trace.from" });
          continue;
        }

        if (event.event.trace.to && eq(event.event.trace.to, arg)) {
          resultArgs.push({ type: "derived", value: "trace.to" });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: "block.hash" });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: "block.number" });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: "block.timestamp" });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: "block.miner" });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.hash" });
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.from" });
          continue;
        }

        if (event.event.transaction.to && eq(event.event.transaction.to, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.to" });
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: "transaction.transactionIndex",
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: "transactionReceipt.contractAddress",
          });
          continue;
        }

        break;
      }

      case "transfer": {
        if (eq(event.event.transfer.from, arg)) {
          resultArgs.push({ type: "derived", value: "transfer.from" });
          continue;
        }

        if (eq(event.event.transfer.to, arg)) {
          resultArgs.push({ type: "derived", value: "transfer.to" });
          continue;
        }

        if (eq(event.event.trace.from, arg)) {
          resultArgs.push({ type: "derived", value: "trace.from" });
          continue;
        }

        if (event.event.trace.to && eq(event.event.trace.to, arg)) {
          resultArgs.push({ type: "derived", value: "trace.to" });
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push({ type: "derived", value: "block.hash" });
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push({ type: "derived", value: "block.number" });
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push({ type: "derived", value: "block.timestamp" });
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push({ type: "derived", value: "block.miner" });
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.hash" });
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.from" });
          continue;
        }

        if (event.event.transaction.to && eq(event.event.transaction.to, arg)) {
          resultArgs.push({ type: "derived", value: "transaction.to" });
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push({
            type: "derived",
            value: "transaction.transactionIndex",
          });
          continue;
        }

        if (
          event.event.transactionReceipt?.contractAddress &&
          eq(event.event.transactionReceipt.contractAddress, arg)
        ) {
          resultArgs.push({
            type: "derived",
            value: "transactionReceipt.contractAddress",
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
  const recover = (obj: object, path: string[]): unknown => {
    if (path.length === 0) return obj;
    const p = path.splice(0, 1);
    // @ts-ignore
    return recover(obj[p[0]], path);
  };

  let address: `0x${string}`;

  if (pattern.address.type === "constant") {
    address = pattern.address.value as `0x${string}`;
  } else {
    address = recover(
      event.event,
      pattern.address.value.split("."),
    ) as `0x${string}`;
  }

  let args: unknown[] | undefined;
  if (pattern.args) {
    args = [];
    for (const arg of pattern.args) {
      if (arg.type === "constant") {
        args.push(arg.value);
      } else {
        args.push(recover(event.event, arg.value.split(".")));
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
