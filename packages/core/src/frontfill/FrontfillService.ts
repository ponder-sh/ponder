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

export type LogFilterGroup = {
  id: string;
  filterKeys: string[];
  filter: Omit<LogFilter["filter"], "key">;
  network: Network;
  startBlockNumber: number;
  startBlockTimestamp: number;
};

export class FrontfillService extends Emittery<FrontfillServiceEvents> {
  resources: Resources;

  private killFunctions: (() => Promise<void>)[] = [];
  private nextBatchIdleFunctions: (() => Promise<void>)[] = [];

  logFilterGroups: LogFilterGroup[] = [];
  currentBlockNumbers: Record<string, number> = {};

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
        if (simpleLogFilters.length > 0) {
          const simpleGroup = {
            id: `${network.name}-simple`,
            filterKeys: simpleLogFilters.map((f) => f.filter.key),
            filter: {
              address: simpleLogFilters.map((f) => f.filter.address as Address),
            },
            network,
            startBlockNumber: latestBlockData.blockNumber,
            startBlockTimestamp: latestBlockData.blockTimestamp,
          };
          this.logFilterGroups.push(simpleGroup);
          this.currentBlockNumbers[simpleGroup.id] =
            latestBlockData.blockNumber;
        }

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
          const group = {
            id: `${network.name}-complex-${index}`,
            filterKeys: [logFilter.filter.key],
            filter: logFilter.filter,
            network,
            startBlockNumber: latestBlockData.blockNumber,
            startBlockTimestamp: latestBlockData.blockTimestamp,
          };
          this.logFilterGroups.push(group);
          this.currentBlockNumbers[group.id] = latestBlockData.blockNumber;
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
      const blockFrontfillQueue = createBlockFrontfillQueue({
        frontfillService: this,
        group,
      });

      const logFrontfillQueue = createLogFrontfillQueue({
        frontfillService: this,
        group,
        blockFrontfillQueue,
      });

      const handleLogs = async (logs: ViemLog[]) => {
        this.emit("nextLogBatch", { network: group.network.name });
        if (logs.length === 0) return;

        await logFrontfillQueue.addTask({ logs });
      };

      const unwatch = group.network.client.watchEvent({
        address: group.filter.address,
        event: group.filter.event,
        args: group.filter.args as unknown as undefined,
        onLogs: handleLogs,
        pollingInterval: group.network.pollingInterval,
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
                    group.network.pollingInterval * 2
                  }ms)`
                )
              ),
            group.network.pollingInterval * 10
          );
          listener = ({ network: _network }) => {
            if (_network === group.network.name) {
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
      logFilterGroupCount: this.logFilterGroups.length,
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
