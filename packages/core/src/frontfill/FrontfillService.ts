import Emittery from "emittery";
import { Log as ViemLog } from "viem";

import { Network } from "@/config/contracts";
import { Resources } from "@/Ponder";

import { createBlockFrontfillQueue } from "./blockFrontfillQueue";
import { createLogFrontfillQueue } from "./logFrontfillQueue";

export type FrontfillServiceEvents = {
  networkConnected: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
  };
  frontfillStarted: { networkCount: number };

  logTasksAdded: { network: string; count: number };
  blockTasksAdded: { network: string; count: number };

  logTaskFailed: { network: string; error: Error };
  blockTaskFailed: { network: string; error: Error };

  logTaskCompleted: {
    network: string;
    logData: Record<number, Record<string, number>>;
  };
  blockTaskCompleted: { network: string };

  eventsAdded: { count: number };
};

export class FrontfillService extends Emittery<FrontfillServiceEvents> {
  resources: Resources;

  private killFunctions: (() => Promise<void>)[] = [];

  liveNetworks: {
    network: Network;
    startBlockNumber: number;
    startBlockTimestamp: number;
    currentBlockNumber: number;
  }[] = [];

  backfillCutoffTimestamp = Number.MAX_SAFE_INTEGER;

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;
  }

  async getLatestBlockNumbers() {
    const liveContracts = this.resources.contracts.filter(
      (contract) => contract.endBlock === undefined && contract.isIndexed
    );

    const uniqueLiveNetworks = liveContracts
      .map((c) => c.network)
      .filter((value, index, self) => self.indexOf(value) === index);

    await Promise.all(
      uniqueLiveNetworks.map(async (network) => {
        const block = await network.client.getBlock({
          blockTag: "latest",
          includeTransactions: false,
        });

        this.emit("networkConnected", {
          network: network.name,
          blockNumber: Number(block.number),
          blockTimestamp: Number(block.timestamp),
        });

        this.liveNetworks.push({
          network,
          startBlockNumber: Number(block.number),
          startBlockTimestamp: Number(block.timestamp),
          currentBlockNumber: Number(block.number),
        });
      })
    );

    // Set `endBlock` to the latest block number for any contract
    // that did not specify one.
    liveContracts.forEach((contract) => {
      const liveNetwork = this.liveNetworks.find(
        (n) => n.network.name === contract.network.name
      );
      contract.endBlock = liveNetwork?.startBlockNumber;
    });

    // Store the latest timestamp among all connected networks.
    // This is used to determine when backfill event processing is complete.
    this.backfillCutoffTimestamp = Math.max(
      ...this.liveNetworks.map((n) => n.startBlockTimestamp)
    );
  }

  startFrontfill() {
    this.liveNetworks.forEach(({ network }) => {
      const contractAddresses = this.resources.contracts
        .filter((contract) => contract.network.name === network.name)
        .map((contract) => contract.address);

      const blockFrontfillQueue = createBlockFrontfillQueue({
        frontfillService: this,
        network,
      });

      const logFrontfillQueue = createLogFrontfillQueue({
        frontfillService: this,
        network,
        contractAddresses,
        blockFrontfillQueue,
      });

      const handleLogs = (logs: ViemLog[]) => {
        if (logs.length === 0) return;

        logFrontfillQueue.push({ logs });
        this.emit("logTasksAdded", {
          network: network.name,
          count: 1,
        });
      };

      const unwatch = network.client.watchEvent({
        address: contractAddresses,
        onLogs: handleLogs,
        pollingInterval: 1_000, // 1 second by default
        batch: true,
      });

      this.killFunctions.push(async () => {
        logFrontfillQueue.kill();
        await logFrontfillQueue.drained();
        blockFrontfillQueue.kill();
        await blockFrontfillQueue.drained();
        unwatch();
      });
    });

    this.emit("frontfillStarted", { networkCount: this.liveNetworks.length });
  }

  async kill() {
    await Promise.all(this.killFunctions.map((f) => f()));
  }
}
