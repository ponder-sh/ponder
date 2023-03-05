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
        const { blockNumber, blockTimestamp } =
          await this.getLatestBlockForNetwork({
            network,
          });
        this.liveNetworks.push({
          network,
          cutoffBlockNumber: blockNumber,
          cutoffBlockTimestamp: blockTimestamp,
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

      const blockListener = (blockNumber: number) => {
        // Messy way to avoid double-processing latestBlockNumber.
        // Also noticed that this approach sometimes skips the block
        // immediately after latestBlockNumber.
        if (blockNumber > cutoffBlockNumber) {
          frontfillQueue.push({ blockNumber });
          this.emit("taskAdded", {
            network: network.name,
            blockNumber,
          });
        }
      };

      network.provider.on("block", blockListener);

      this.queueKillFunctions.push(() => {
        frontfillQueue.kill();
        network.provider.off("block", blockListener);
      });
    });
  }

  killQueues() {
    this.queueKillFunctions.forEach((f) => f());
  }

  private async getLatestBlockForNetwork({ network }: { network: Network }) {
    // Kinda weird but should work to make sure this RPC request gets done
    let blockRequestCount = 0;
    let blockNumber: number | null = null;
    let blockTimestamp: number | null = null;

    while (blockNumber === null || blockTimestamp === null) {
      try {
        const block = await network.provider.getBlock("latest");
        blockNumber = block.number;
        blockTimestamp = block.timestamp;
      } catch (err) {
        this.resources.logger.warn(
          `Failed to fetch latest block for network [${network.name}], retrying...`
        );
        blockRequestCount += 1;
        if (blockRequestCount > 5) {
          this.resources.logger.error(
            `Unable to get latest block after 5 retries:`
          );
          throw err;
        }
      }
    }

    this.emit("networkConnected", {
      network: network.name,
      blockNumber,
      blockTimestamp,
    });

    return { blockNumber, blockTimestamp };
  }
}
