import type { Event } from "@/internal/types.js";
import type { Abi } from "viem";
import type { PonderActions, ProfilePattern, Request } from "./client.js";

export const getProfilePatternKey = (pattern: ProfilePattern): string => {
  return `${pattern.address}_${pattern.functionName}_${pattern.args?.join("_")}`;
};

const eq = (target: unknown, value: unknown) => {
  if (!target) return false;
  if (target === value) return true;
  if (target && value && target.toString() === value.toString()) return true;
  return false;
};

export const recordProfilePattern = ({
  event,
  args,
}: {
  event: Event;
  args: Omit<
    Parameters<PonderActions["readContract"]>[0],
    "blockNumber" | "cache"
  >;
}): ProfilePattern | undefined => {
  let resultAddress: ProfilePattern["address"] | undefined;

  // address

  switch (event.type) {
    case "block": {
      if (eq(event.event.block.miner, args.address)) {
        resultAddress = "block.miner";
        break;
      }

      break;
    }

    case "transaction": {
      if (eq(event.event.block.miner, args.address)) {
        resultAddress = "block.miner";
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = "transaction.from";
        break;
      }

      if (eq(event.event.transaction.to, args.address)) {
        resultAddress = "transaction.to";
        break;
      }

      if (eq(event.event.transactionReceipt?.contractAddress, args.address)) {
        resultAddress = "transactionReceipt.contractAddress";
        break;
      }

      break;
    }

    case "log": {
      let hasMatch = false;
      for (const argKey of Object.keys(event.event.args)) {
        const argValue = event.event.args[argKey];

        if (eq(argValue, args.address)) {
          resultAddress = `args.${argKey}`;
          hasMatch = true;
          break;
        }
      }

      if (hasMatch) break;

      if (eq(event.event.log.address, args.address)) {
        resultAddress = "log.address";
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = "block.miner";
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = "transaction.from";
        break;
      }

      if (eq(event.event.transaction.to, args.address)) {
        resultAddress = "transaction.to";
        break;
      }

      if (eq(event.event.transactionReceipt?.contractAddress, args.address)) {
        resultAddress = "transactionReceipt.contractAddress";
        break;
      }

      break;
    }

    case "trace": {
      let hasMatch = false;
      for (const argKey of Object.keys(event.event.args)) {
        const argValue = event.event.args[argKey];

        if (eq(argValue, args.address)) {
          resultAddress = `args.${argKey}`;
          hasMatch = true;
          break;
        }
      }

      if (hasMatch) break;

      if (eq(event.event.trace.from, args.address)) {
        resultAddress = "trace.from";
        break;
      }

      if (eq(event.event.trace.to, args.address)) {
        resultAddress = "trace.to";
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = "block.miner";
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = "transaction.from";
        break;
      }

      if (eq(event.event.transaction.to, args.address)) {
        resultAddress = "transaction.to";
        break;
      }

      if (eq(event.event.transactionReceipt?.contractAddress, args.address)) {
        resultAddress = "transactionReceipt.contractAddress";
        break;
      }

      break;
    }

    case "transfer": {
      if (eq(event.event.transfer.from, args.address)) {
        resultAddress = "transfer.from";
        break;
      }

      if (eq(event.event.transfer.to, args.address)) {
        resultAddress = "transfer.to";
        break;
      }

      if (eq(event.event.trace.from, args.address)) {
        resultAddress = "trace.from";
        break;
      }

      if (eq(event.event.trace.to, args.address)) {
        resultAddress = "trace.to";
        break;
      }

      if (eq(event.event.block.miner, args.address)) {
        resultAddress = "block.miner";
        break;
      }

      if (eq(event.event.transaction.from, args.address)) {
        resultAddress = "transaction.from";
        break;
      }

      if (eq(event.event.transaction.to, args.address)) {
        resultAddress = "transaction.to";
        break;
      }

      if (eq(event.event.transactionReceipt?.contractAddress, args.address)) {
        resultAddress = "transactionReceipt.contractAddress";
        break;
      }

      break;
    }
  }

  if (args.args === undefined || args.args.length === 0) {
    if (resultAddress) {
      return {
        address: resultAddress,
        abi: args.abi as Abi,
        functionName: args.functionName,
        args: undefined,
      };
    }
    return undefined;
  }

  const resultArgs: NonNullable<ProfilePattern["args"]> = [];

  // args

  for (const arg of args.args) {
    switch (event.type) {
      case "block": {
        if (eq(event.event.block.hash, arg)) {
          resultArgs.push("block.hash");
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push("block.number");
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push("block.timestamp");
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push("block.miner");
          continue;
        }

        break;
      }

      case "transaction": {
        if (eq(event.event.block.hash, arg)) {
          resultArgs.push("block.hash");
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push("block.number");
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push("block.timestamp");
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push("block.miner");
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push("transaction.hash");
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push("transaction.from");
          continue;
        }

        if (eq(event.event.transaction.to, arg)) {
          resultArgs.push("transaction.to");
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push("transaction.transactionIndex");
          continue;
        }

        if (eq(event.event.transactionReceipt?.contractAddress, arg)) {
          resultArgs.push("transactionReceipt.contractAddress");
          continue;
        }

        break;
      }

      case "log": {
        let hasMatch = false;
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (eq(argValue, arg)) {
            resultArgs.push(`args.${argKey}`);
            hasMatch = true;
            break;
          }
        }

        if (hasMatch) continue;

        if (eq(event.event.log.address, arg)) {
          resultArgs.push("log.address");
          continue;
        }

        if (eq(event.event.log.logIndex, arg)) {
          resultArgs.push("log.logIndex");
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push("block.hash");
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push("block.number");
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push("block.timestamp");
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push("block.miner");
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push("transaction.hash");
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push("transaction.from");
          continue;
        }

        if (eq(event.event.transaction.to, arg)) {
          resultArgs.push("transaction.to");
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push("transaction.transactionIndex");
          continue;
        }

        if (eq(event.event.transactionReceipt?.contractAddress, arg)) {
          resultArgs.push("transactionReceipt.contractAddress");
          continue;
        }

        break;
      }

      case "trace": {
        let hasMatch = false;
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (eq(argValue, arg)) {
            resultArgs.push(`args.${argKey}`);
            hasMatch = true;
            break;
          }
        }

        if (hasMatch) continue;

        if (eq(event.event.trace.from, arg)) {
          resultArgs.push("trace.from");
          continue;
        }

        if (eq(event.event.trace.to, arg)) {
          resultArgs.push("trace.to");
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push("block.hash");
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push("block.number");
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push("block.timestamp");
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push("block.miner");
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push("transaction.hash");
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push("transaction.from");
          continue;
        }

        if (eq(event.event.transaction.to, arg)) {
          resultArgs.push("transaction.to");
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push("transaction.transactionIndex");
          continue;
        }

        if (eq(event.event.transactionReceipt?.contractAddress, arg)) {
          resultArgs.push("transactionReceipt.contractAddress");
          continue;
        }

        break;
      }

      case "transfer": {
        if (eq(event.event.transfer.from, arg)) {
          resultArgs.push("transfer.from");
          continue;
        }

        if (eq(event.event.transfer.to, arg)) {
          resultArgs.push("transfer.to");
          continue;
        }

        if (eq(event.event.trace.from, arg)) {
          resultArgs.push("trace.from");
          continue;
        }

        if (eq(event.event.trace.to, arg)) {
          resultArgs.push("trace.to");
          continue;
        }

        if (eq(event.event.block.hash, arg)) {
          resultArgs.push("block.hash");
          continue;
        }

        if (eq(event.event.block.number, arg)) {
          resultArgs.push("block.number");
          continue;
        }

        if (eq(event.event.block.timestamp, arg)) {
          resultArgs.push("block.timestamp");
          continue;
        }

        if (eq(event.event.block.miner, arg)) {
          resultArgs.push("block.miner");
          continue;
        }

        if (eq(event.event.transaction.hash, arg)) {
          resultArgs.push("transaction.hash");
          continue;
        }

        if (eq(event.event.transaction.from, arg)) {
          resultArgs.push("transaction.from");
          continue;
        }

        if (eq(event.event.transaction.to, arg)) {
          resultArgs.push("transaction.to");
          continue;
        }

        if (eq(event.event.transaction.transactionIndex, arg)) {
          resultArgs.push("transaction.transactionIndex");
          continue;
        }

        if (eq(event.event.transactionReceipt?.contractAddress, arg)) {
          resultArgs.push("transactionReceipt.contractAddress");
          continue;
        }

        break;
      }
    }

    return undefined;
  }

  return {
    address: resultAddress!,
    abi: args.abi as Abi,
    functionName: args.functionName,
    args: resultArgs,
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

  return {
    address: recover(event.event, pattern.address.split(".")) as `0x${string}`,
    abi: pattern.abi,
    functionName: pattern.functionName,
    args: pattern.args?.map((arg) => recover(event.event, arg.split("."))),
    blockNumber: event.event.block.number,
    chainId: event.chainId,
  };
};
