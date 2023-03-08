import Emittery from "emittery";

import { Network } from "@/config/contracts";
import { Resources } from "@/Ponder";

import { createBlockFrontfillQueue } from "./blockFrontfillQueue";

type FrontfillServiceEvents = {
  networkConnected: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
  };

  taskAdded: { network: string; blockNumber: number };
  taskFailed: { network: string; error: Error };
  taskCompleted: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
    blockTxCount: number;
    matchedLogCount: number;
  };

  eventsAdded: { count: number };
};

export class FrontfillService extends Emittery<FrontfillServiceEvents> {
  resources: Resources;

  private queueKillFunctions: (() => void)[] = [];
  private liveNetworks: {
    network: Network;
    cutoffBlockNumber: number;
    cutoffBlockTimestamp: number;
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
          cutoffBlockNumber: Number(block.number),
          cutoffBlockTimestamp: Number(block.timestamp),
        });
      })
    );

    liveContracts.forEach((contract) => {
      const liveNetwork = this.liveNetworks.find(
        (n) => n.network.name === contract.network.name
      );
      contract.endBlock = liveNetwork?.cutoffBlockNumber;
    });

    this.backfillCutoffTimestamp = Math.max(
      ...this.liveNetworks.map((n) => n.cutoffBlockTimestamp)
    );
  }

  startFrontfill() {
    this.liveNetworks.forEach((liveNetwork) => {
      const { network, cutoffBlockNumber } = liveNetwork;

      const contractAddresses = this.resources.contracts
        .filter((contract) => contract.network.name === network.name)
        .map((contract) => contract.address);

      const frontfillQueue = createBlockFrontfillQueue({
        frontfillService: this,
        network,
        contractAddresses,
      });

      const blockListener = (blockNumber: bigint) => {
        // Messy way to avoid double-processing latestBlockNumber.
        // Also noticed that this approach sometimes skips the block
        // immediately after latestBlockNumber.
        if (blockNumber > cutoffBlockNumber) {
          frontfillQueue.push({ blockNumber: Number(blockNumber) });
          this.emit("taskAdded", {
            network: network.name,
            blockNumber: Number(blockNumber),
          });
        }
      };

      const unwatch = network.client.watchBlockNumber({
        onBlockNumber: blockListener,
      });

      this.queueKillFunctions.push(() => {
        frontfillQueue.kill();
        unwatch();
      });
    });
  }

  killQueues() {
    this.queueKillFunctions.forEach((f) => f());
  }
}
