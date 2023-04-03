import Emittery from "emittery";
import { Address, Log as ViemLog } from "viem";

import { LogFilter } from "@/config/logFilters";
import { Network } from "@/config/networks";
import { Resources } from "@/Ponder";

import { createBlockFrontfillQueue } from "./blockFrontfillQueue";
import { createLogFrontfillQueue } from "./logFrontfillQueue";

export type FrontfillServiceEvents = {
  networkConnected: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
  };
  frontfillStarted: { logFilterGroupCount: number };

  logTasksAdded: { network: string; count: number };
  logTaskFailed: { network: string; error: Error };
  logTaskCompleted: {
    network: string;
    logData: Record<number, Record<string, number>>;
  };

  blockTasksAdded: { network: string; count: number };
  blockTaskFailed: { network: string; error: Error };
  blockTaskCompleted: { network: string };

  nextLogBatch: { network: string };
  eventsAdded: undefined;
};

type LogFilterGroup = {
  id: string;
  filterKeys: string[];
  filter: LogFilter["filter"];
  network: Network;
  startBlockNumber: number;
  startBlockTimestamp: number;
  currentBlockNumber: number;
};

export class FrontfillService extends Emittery<FrontfillServiceEvents> {
  resources: Resources;

  private killFunctions: (() => Promise<void>)[] = [];
  private nextBatchIdleFunctions: (() => Promise<void>)[] = [];

  logFilterGroups: LogFilterGroup[] = [];

  backfillCutoffTimestamp = Number.POSITIVE_INFINITY;

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;
  }

  async getLatestBlockNumbers() {
    const liveLogFilters = this.resources.logFilters.filter(
      (f) => f.endBlock === undefined
    );

    // If there are no live log filters, set backfillCutoffTimestamp to the
    // greatest timestamp among all the end blocks of all historical log filters.
    if (liveLogFilters.length === 0) {
      this.backfillCutoffTimestamp = await this.getMaxEndBlockTimestamp();
      return;
    }

    const liveNetworks = [
      ...new Map(
        liveLogFilters.map((f) => [f.network.name, f.network])
      ).values(),
    ];

    await Promise.all(
      liveNetworks.map(async (network) => {
        const block = await network.client.getBlock({
          blockTag: "latest",
          includeTransactions: false,
        });

        const latestBlockData = {
          blockNumber: Number(block.number),
          blockTimestamp: Number(block.timestamp),
        };

        // Create a live log filter groups for all "simple" log filters on this network.
        // A "simple" log filter group has just one contract address and no topics.
        const simpleLogFilters = this.resources.logFilters.filter(
          (f): f is LogFilter & { address: Address } =>
            f.network.name === network.name && // Is on this network.
            f.endBlock === undefined && // Is a live filter.
            typeof f.filter.address === "string" && // Is a single contract.
            f.filter.topics === undefined // Is simple.
        );

        this.logFilterGroups.push({
          id: `${network.name}-simple`,
          filterKeys: simpleLogFilters.map((f) => f.filterKey),
          filter: {
            address: simpleLogFilters.map((f) => f.filter.address as Address),
            topics: undefined,
          },
          network,
          startBlockNumber: latestBlockData.blockNumber,
          startBlockTimestamp: latestBlockData.blockTimestamp,
          currentBlockNumber: latestBlockData.blockNumber,
        });

        // Create a live log filter group for each "complex" log filter on this network.
        // This includes any log filters that specify topics, or don't specify a single address.
        const complexLogFilters = this.resources.logFilters.filter(
          (f) =>
            f.network.name === network.name && // Is on this network.
            f.endBlock === undefined && // Is a live filter.
            (typeof f.filter.address !== "string" || // Is not a single contract.
              f.filter.topics !== undefined) // Is not simple.
        );

        complexLogFilters.forEach((logFilter, index) => {
          this.logFilterGroups.push({
            id: `${network.name}-complex-${index}`,
            filterKeys: [logFilter.filterKey],
            filter: logFilter.filter,
            network,
            startBlockNumber: latestBlockData.blockNumber,
            startBlockTimestamp: latestBlockData.blockTimestamp,
            currentBlockNumber: latestBlockData.blockNumber,
          });
        });

        // Set `endBlock` to the latest block number for any log filters that did not specify one.
        // This dangerously mutates `resources.logFilters`, and should be reconsidered.
        this.resources.logFilters.forEach((logFilter) => {
          if (logFilter.network.name === network.name) {
            logFilter.endBlock = latestBlockData.blockNumber;
          }
        });

        // Update the max timestamp.
        this.backfillCutoffTimestamp = Math.max(
          this.backfillCutoffTimestamp,
          latestBlockData.blockTimestamp
        );

        this.emit("networkConnected", {
          network: network.name,
          ...latestBlockData,
        });
      })
    );
  }

  startFrontfill() {
    // If there are no live networks, return early.
    if (this.logFilterGroups.length === 0) return;

    this.logFilterGroups.forEach((group) => {
      const { filterKeys, network } = group;
      const { pollingInterval } = network;

      const blockFrontfillQueue = createBlockFrontfillQueue({
        frontfillService: this,
        network,
      });

      const logFrontfillQueue = createLogFrontfillQueue({
        frontfillService: this,
        network,
        filterKeys,
        blockFrontfillQueue,
      });

      const handleLogs = async (logs: ViemLog[]) => {
        this.emit("nextLogBatch", { network: network.name });
        if (logs.length === 0) return;

        await logFrontfillQueue.addTask({ logs });
      };

      const unwatch = network.client.watchEvent({
        address: contractAddresses,
        onLogs: handleLogs,
        pollingInterval,
        batch: true,
      });

      this.killFunctions.push(async () => {
        unwatch();
        logFrontfillQueue.clear();
        await logFrontfillQueue.onIdle();
        blockFrontfillQueue.clear();
        await blockFrontfillQueue.onIdle();
      });

      this.nextBatchIdleFunctions.push(async () => {
        let listener: (
          event: FrontfillServiceEvents["nextLogBatch"]
        ) => void = () => undefined;

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () =>
              reject(
                new Error(
                  `Did not receive event "newLogBatch" within timeout (${
                    pollingInterval * 2
                  }ms)`
                )
              ),
            pollingInterval * 10
          );
          listener = ({ network: _network }) => {
            if (_network === network.name) {
              clearTimeout(timeout);
              resolve();
            }
          };
          this.on("nextLogBatch", listener);
        });

        this.off("nextLogBatch", listener);

        await logFrontfillQueue.onIdle();
        await blockFrontfillQueue.onIdle();
      });
    });

    this.emit("frontfillStarted", {
      logFilterGroupCount: this.liveLogFilterGroups.length,
    });
  }

  async kill() {
    await Promise.all(this.killFunctions.map((f) => f()));
  }

  // This function returns a promise that resolves when the next
  // `eth_getFilterChanges` request is complete AND all tasks
  // resulting from that batch of logs have been processed,
  // for ALL live networks.
  async nextBatchesIdle() {
    await Promise.all(this.nextBatchIdleFunctions.map((f) => f()));
  }

  private async getMaxEndBlockTimestamp() {
    const blocks = await Promise.all(
      this.resources.logFilters
        .filter((logFilter) => logFilter.endBlock !== undefined)
        .map(async (logFilter) => {
          return await logFilter.network.client.getBlock({
            blockNumber: BigInt(logFilter.endBlock!),
            includeTransactions: false,
          });
        })
    );

    const maxEndBlockTimestamp = Math.max(
      ...blocks.map((block) => Number(block.timestamp))
    );

    return maxEndBlockTimestamp;
  }
}
