import type { IndexingBuild, SchemaBuild } from "@/build/index.js";
import type { Common } from "@/common/common.js";
import { BaseError } from "@/common/errors.js";
import type { Network } from "@/config/networks.js";
import type { Database } from "@/database/index.js";
import type { Drizzle, Schema } from "@/drizzle/index.js";
import { createIndexingStore } from "@/indexing-store/index.js";
import type { Sync } from "@/sync/index.js";
import { type ContractSource, isAddressFactory } from "@/sync/source.js";
import type { Db } from "@/types/db.js";
import type { Block, Log, Trace, Transaction } from "@/types/eth.js";
import {
  type Checkpoint,
  decodeCheckpoint,
  encodeCheckpoint,
  zeroCheckpoint,
} from "@/utils/checkpoint.js";
import { prettyPrint } from "@/utils/print.js";
import { startClock } from "@/utils/timer.js";
import type { Abi, Address } from "viem";
import { checksumAddress, createClient } from "viem";
import type { Event, SetupEvent } from "../sync/events.js";
import { addStackTrace } from "./addStackTrace.js";
import { type ReadOnlyClient, getPonderActions } from "./ponderActions.js";

type Context = {
  network: { chainId: number; name: string };
  client: ReadOnlyClient;
  db: Db<Schema>;
  contracts: Record<
    string,
    {
      abi: Abi;
      address?: Address | readonly Address[];
      startBlock?: number;
      endBlock?: number;
    }
  >;
};

export type Indexing = {
  processSetupEvents: ({
    tx,
  }: {
    tx: Parameters<Parameters<Drizzle<Schema>["transaction"]>[0]>[0];
  }) => Promise<
    | { status: "error"; error: Error }
    | { status: "success" }
    | { status: "killed" }
  >;
  processEvents: ({
    events,
    tx,
  }: {
    events: Event[];
    tx: Parameters<Parameters<Drizzle<Schema>["transaction"]>[0]>[0];
  }) => Promise<
    | { status: "error"; error: Error }
    | { status: "success" }
    | { status: "killed" }
  >;
  updateTotalSeconds: ({ checkpoint }: { checkpoint: Checkpoint }) => void;
  kill: () => void;
};

export const createIndexing = ({
  common,
  database,
  indexingBuild,
  schemaBuild,
  sync,
}: {
  common: Common;
  database: Database;
  indexingBuild: Omit<IndexingBuild, "buildId">;
  schemaBuild: Pick<SchemaBuild, "schema">;
  sync: Sync;
}): Indexing => {
  let isKilled = false;
  const startCheckpoint = decodeCheckpoint(sync.getStartCheckpoint());

  let blockNumber: bigint = undefined!;
  const context: Context = {
    network: { name: undefined!, chainId: undefined! },
    contracts: undefined!,
    client: undefined!,
    db: undefined!,
  };

  const eventCount: { [eventName: string]: number } = {};
  const networkByChainId: { [chainId: number]: Network } = {};
  const clientByChainId: { [chainId: number]: ReadOnlyClient } = {};
  const contractsByChainId: {
    [chainId: number]: Record<
      string,
      {
        abi: Abi;
        address?: Address | readonly Address[];
        startBlock?: number;
        endBlock?: number;
      }
    >;
  } = {};

  // build eventCount
  for (const eventName of Object.keys(indexingBuild.indexingFunctions)) {
    eventCount[eventName] = 0;
  }

  // build networkByChainId
  for (const network of indexingBuild.networks) {
    networkByChainId[network.chainId] = network;
  }

  // build contractsByChainId
  for (const source of indexingBuild.sources) {
    if (source.type === "block" || source.type === "account") continue;

    let address: Address | undefined;

    if (source.filter.type === "log") {
      const _address = source.filter.address;
      if (
        isAddressFactory(_address) === false &&
        Array.isArray(_address) === false &&
        _address !== undefined
      ) {
        address = _address as Address;
      }
    } else {
      const _address = source.filter.toAddress;
      if (isAddressFactory(_address) === false && _address !== undefined) {
        address = (_address as Address[])[0];
      }
    }

    if (contractsByChainId[source.filter.chainId] === undefined) {
      contractsByChainId[source.filter.chainId] = {};
    }

    // Note: multiple sources with the same contract (logs and traces)
    // should only create one entry in the `contracts` object
    if (contractsByChainId[source.filter.chainId]![source.name] !== undefined)
      continue;

    contractsByChainId[source.filter.chainId]![source.name] = {
      abi: source.abi,
      address: address ? checksumAddress(address) : address,
      startBlock: source.filter.fromBlock,
      endBlock: source.filter.toBlock,
    };
  }

  // build clientByChainId
  for (const network of indexingBuild.networks) {
    const transport = sync.getCachedTransport(network);
    clientByChainId[network.chainId] = createClient({
      transport,
      chain: network.chain,
      // @ts-ignore
    }).extend(getPonderActions(() => blockNumber!));
  }

  const updateCompletedEvents = () => {
    for (const event of Object.keys(eventCount)) {
      const metricLabel = {
        event,
      };
      common.metrics.ponder_indexing_completed_events.set(
        metricLabel,
        eventCount[event]!,
      );
    }
  };

  const executeSetup = async ({
    event,
  }: { event: SetupEvent }): Promise<
    | { status: "error"; error: Error }
    | { status: "success" }
    | { status: "killed" }
  > => {
    const indexingFunction = indexingBuild.indexingFunctions[event.name];
    const metricLabel = { event: event.name };

    try {
      blockNumber = event.block;
      context.network.chainId = event.chainId;
      context.network.name = networkByChainId[event.chainId]!.name;
      context.client = clientByChainId[event.chainId]!;
      context.contracts = contractsByChainId[event.chainId]!;

      const endClock = startClock();

      await indexingFunction!({ context });

      common.metrics.ponder_indexing_function_duration.observe(
        metricLabel,
        endClock(),
      );
    } catch (_error) {
      if (isKilled) return { status: "killed" };
      const error =
        _error instanceof Error ? _error : new Error(String(_error));

      addStackTrace(error, common.options);

      if (error instanceof BaseError) {
        error.meta.push(toErrorMeta(event));
      } else {
        // @ts-expect-error
        error.meta = [toErrorMeta(event)];
      }

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);
      common.logger.error({
        service: "indexing",
        msg: `Error while processing '${event.name}' event in '${networkByChainId[event.chainId]!.name}' block ${decodedCheckpoint.blockNumber}`,
        error,
      });

      common.metrics.ponder_indexing_has_error.set(1);

      return { status: "error", error: error };
    }

    return { status: "success" };
  };

  const executeEvent = async ({
    event,
  }: { event: Event }): Promise<
    | { status: "error"; error: Error }
    | { status: "success" }
    | { status: "killed" }
  > => {
    const indexingFunction = indexingBuild.indexingFunctions[event.name];
    const metricLabel = { event: event.name };

    try {
      blockNumber = event.event.block.number;
      context.network.chainId = event.chainId;
      context.network.name = networkByChainId[event.chainId]!.name;
      context.client = clientByChainId[event.chainId]!;
      context.contracts = contractsByChainId[event.chainId]!;

      const endClock = startClock();

      await indexingFunction!({ event: event.event, context });

      common.metrics.ponder_indexing_function_duration.observe(
        metricLabel,
        endClock(),
      );
    } catch (_error) {
      if (isKilled) return { status: "killed" };
      const error =
        _error instanceof Error ? _error : new Error(String(_error));

      addStackTrace(error, common.options);

      if (error instanceof BaseError) {
        error.meta.push(toErrorMeta(event));
      } else {
        // @ts-expect-error
        error.meta = [toErrorMeta(event)];
      }

      const decodedCheckpoint = decodeCheckpoint(event.checkpoint);

      common.logger.error({
        service: "indexing",
        msg: `Error while processing '${event.name}' event in '${networkByChainId[event.chainId]!.name}' block ${decodedCheckpoint.blockNumber}`,
        error,
      });

      common.metrics.ponder_indexing_has_error.set(1);

      return { status: "error", error };
    }

    return { status: "success" };
  };

  return {
    async processSetupEvents({ tx }) {
      context.db = createIndexingStore({
        common,
        database,
        schemaBuild,
        tx,
      });
      for (const eventName of Object.keys(indexingBuild.indexingFunctions)) {
        if (!eventName.endsWith(":setup")) continue;

        const [contractName] = eventName.split(":");

        for (const network of indexingBuild.networks) {
          const source = indexingBuild.sources.find(
            (s) =>
              s.type === "contract" &&
              s.name === contractName &&
              s.filter.chainId === network.chainId,
          ) as ContractSource | undefined;

          if (source === undefined) continue;

          if (isKilled) return { status: "killed" };

          eventCount[eventName]!++;

          const result = await executeSetup({
            event: {
              type: "setup",
              chainId: network.chainId,
              checkpoint: encodeCheckpoint({
                ...zeroCheckpoint,
                chainId: BigInt(network.chainId),
                blockNumber: BigInt(source.filter.fromBlock ?? 0),
              }),

              name: eventName,

              block: BigInt(source.filter.fromBlock ?? 0),
            },
          });

          if (result.status !== "success") {
            return result;
          }
        }
      }

      return { status: "success" };
    },
    async processEvents({ events, tx }) {
      context.db = createIndexingStore({
        common,
        database,
        schemaBuild,
        tx,
      });
      for (let i = 0; i < events.length; i++) {
        if (isKilled) return { status: "killed" };

        const event = events[i]!;

        eventCount[event.name]!++;

        common.logger.trace({
          service: "indexing",
          msg: `Started indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        const result = await executeEvent({ event });
        if (result.status !== "success") {
          return result;
        }

        common.logger.trace({
          service: "indexing",
          msg: `Completed indexing function (event="${event.name}", checkpoint=${event.checkpoint})`,
        });

        // periodically update metrics
        if (i % 93 === 0) {
          updateCompletedEvents();

          const eventTimestamp = decodeCheckpoint(
            event.checkpoint,
          ).blockTimestamp;

          common.metrics.ponder_indexing_completed_seconds.set(
            eventTimestamp - startCheckpoint.blockTimestamp,
          );
          common.metrics.ponder_indexing_completed_timestamp.set(
            eventTimestamp,
          );

          // Note: allows for terminal and logs to be updated
          await new Promise(setImmediate);
        }
      }

      // set completed seconds
      if (events.length > 0) {
        const lastEventInBatchTimestamp = decodeCheckpoint(
          events[events.length - 1]!.checkpoint,
        ).blockTimestamp;

        common.metrics.ponder_indexing_completed_seconds.set(
          lastEventInBatchTimestamp - startCheckpoint.blockTimestamp,
        );
        common.metrics.ponder_indexing_completed_timestamp.set(
          lastEventInBatchTimestamp,
        );
      }
      // set completed events
      updateCompletedEvents();

      return { status: "success" };
    },
    updateTotalSeconds({ checkpoint }) {
      common.metrics.ponder_indexing_total_seconds.set(
        checkpoint.blockTimestamp - startCheckpoint.blockTimestamp,
      );
    },
    kill() {
      common.logger.debug({
        service: "indexing",
        msg: "Killed indexing service",
      });
      isKilled = true;
    },
  };
};

const blockText = (block: Block) =>
  `Block:\n${prettyPrint({
    hash: block.hash,
    number: block.number,
    timestamp: block.timestamp,
  })}`;

const transactionText = (transaction: Transaction) =>
  `Transaction:\n${prettyPrint({
    hash: transaction.hash,
    from: transaction.from,
    to: transaction.to,
  })}`;

const logText = (log: Log) =>
  `Log:\n${prettyPrint({
    index: log.logIndex,
    address: log.address,
  })}`;

const traceText = (trace: Trace) =>
  `Trace:\n${prettyPrint({
    traceIndex: trace.traceIndex,
    from: trace.from,
    to: trace.to,
  })}`;

const toErrorMeta = (event: Event | SetupEvent) => {
  switch (event.type) {
    case "setup": {
      return `Block:\n${prettyPrint({
        number: event.block,
      })}`;
    }

    case "log": {
      return [
        `Event arguments:\n${prettyPrint(event.event.args)}`,
        logText(event.event.log),
        transactionText(event.event.transaction),
        blockText(event.event.block),
      ].join("\n");
    }

    case "trace": {
      return [
        `Call trace arguments:\n${prettyPrint(event.event.args)}`,
        traceText(event.event.trace),
        transactionText(event.event.transaction),
        blockText(event.event.block),
      ].join("\n");
    }

    case "transfer": {
      return [
        `Transfer arguments:\n${prettyPrint(event.event.transfer)}`,
        traceText(event.event.trace),
        transactionText(event.event.transaction),
        blockText(event.event.block),
      ].join("\n");
    }

    case "block": {
      return blockText(event.event.block);
    }

    case "transaction": {
      return [
        transactionText(event.event.transaction),
        blockText(event.event.block),
      ].join("\n");
    }
  }
};
