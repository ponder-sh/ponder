import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import type { Event } from "@/internal/types.js";
import type { Table } from "drizzle-orm";

export const recoverAccess = (
  event: Event,
  table: Table,
  key: object,
): { [key: string]: string } | undefined => {
  const result: { [key: string]: string } = {};

  for (const { js } of getPrimaryKeyColumns(table)) {
    // @ts-ignore
    const value = key[js]!;

    switch (event.type) {
      case "block": {
        if (event.event.block.hash === value) {
          result[js] = "block.hash";
          break;
        }

        if (event.event.block.number === value) {
          result[js] = "block.number";
          break;
        }

        if (event.event.block.timestamp === value) {
          result[js] = "block.timestamp";
          break;
        }

        if (event.event.block.miner === value) {
          result[js] = "block.miner";
          break;
        }

        break;
      }

      case "transaction": {
        if (event.event.block.hash === value) {
          result[js] = "block.hash";
          break;
        }

        if (event.event.block.number === value) {
          result[js] = "block.number";
          break;
        }

        if (event.event.block.timestamp === value) {
          result[js] = "block.timestamp";
          break;
        }

        if (event.event.block.miner === value) {
          result[js] = "block.miner";
          break;
        }

        if (event.event.transaction.hash === value) {
          result[js] = "transaction.hash";
          break;
        }

        if (event.event.transaction.from === value) {
          result[js] = "transaction.from";
          break;
        }

        if (event.event.transaction.to === value) {
          result[js] = "transaction.to";
          break;
        }

        if (event.event.transaction.transactionIndex === value) {
          result[js] = "transaction.transactionIndex";
          break;
        }

        if (event.event.transactionReceipt?.contractAddress === value) {
          result[js] = "transactionReceipt.contractAddress";
          break;
        }

        break;
      }

      case "log": {
        for (const argKey of Object.keys(event.event.args)) {
          const argValue = event.event.args[argKey];

          if (argValue === value) {
            result[js] = `args.${argKey}`;
          }
        }

        if (result[js]) break;

        if (event.event.log.address === value) {
          result[js] = "log.address";
          break;
        }

        if (event.event.log.id === value) {
          result[js] = "log.id";
          break;
        }

        if (event.event.log.logIndex === value) {
          result[js] = "log.logIndex";
          break;
        }

        if (event.event.block.hash === value) {
          result[js] = "block.hash";
          break;
        }

        if (event.event.block.number === value) {
          result[js] = "block.number";
          break;
        }

        if (event.event.block.timestamp === value) {
          result[js] = "block.timestamp";
          break;
        }

        if (event.event.block.miner === value) {
          result[js] = "block.miner";
          break;
        }

        if (event.event.transaction.hash === value) {
          result[js] = "transaction.hash";
          break;
        }

        if (event.event.transaction.from === value) {
          result[js] = "transaction.from";
          break;
        }

        if (event.event.transaction.to === value) {
          result[js] = "transaction.to";
          break;
        }

        if (event.event.transaction.transactionIndex === value) {
          result[js] = "transaction.transactionIndex";
          break;
        }

        if (event.event.transactionReceipt?.contractAddress === value) {
          result[js] = "transactionReceipt.contractAddress";
          break;
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

        if (result[js]) break;

        if (event.event.trace.from === value) {
          result[js] = "trace.from";
          break;
        }

        if (event.event.trace.id === value) {
          result[js] = "trace.id";
          break;
        }

        if (event.event.block.hash === value) {
          result[js] = "block.hash";
          break;
        }

        if (event.event.block.number === value) {
          result[js] = "block.number";
          break;
        }

        if (event.event.block.timestamp === value) {
          result[js] = "block.timestamp";
          break;
        }

        if (event.event.block.miner === value) {
          result[js] = "block.miner";
          break;
        }

        if (event.event.transaction.hash === value) {
          result[js] = "transaction.hash";
          break;
        }

        if (event.event.transaction.from === value) {
          result[js] = "transaction.from";
          break;
        }

        if (event.event.transaction.to === value) {
          result[js] = "transaction.to";
          break;
        }

        if (event.event.transaction.transactionIndex === value) {
          result[js] = "transaction.transactionIndex";
          break;
        }

        if (event.event.transactionReceipt?.contractAddress === value) {
          result[js] = "transactionReceipt.contractAddress";
          break;
        }

        break;
      }

      case "transfer": {
        if (event.event.transfer.from === value) {
          result[js] = "transfer.from";
          break;
        }

        if (event.event.transfer.to === value) {
          result[js] = "transfer.to";
          break;
        }

        if (event.event.trace.from === value) {
          result[js] = "trace.from";
          break;
        }

        if (event.event.trace.id === value) {
          result[js] = "trace.id";
          break;
        }

        if (event.event.block.hash === value) {
          result[js] = "block.hash";
          break;
        }

        if (event.event.block.number === value) {
          result[js] = "block.number";
          break;
        }

        if (event.event.block.timestamp === value) {
          result[js] = "block.timestamp";
          break;
        }

        if (event.event.block.miner === value) {
          result[js] = "block.miner";
          break;
        }

        if (event.event.transaction.hash === value) {
          result[js] = "transaction.hash";
          break;
        }

        if (event.event.transaction.from === value) {
          result[js] = "transaction.from";
          break;
        }

        if (event.event.transaction.to === value) {
          result[js] = "transaction.to";
          break;
        }

        if (event.event.transaction.transactionIndex === value) {
          result[js] = "transaction.transactionIndex";
          break;
        }

        if (event.event.transactionReceipt?.contractAddress === value) {
          result[js] = "transactionReceipt.contractAddress";
          break;
        }

        break;
      }
    }

    return undefined;
  }

  return result;
};
