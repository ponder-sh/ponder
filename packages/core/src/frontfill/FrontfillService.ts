import { EventEmitter } from "@/common/EventEmitter";
import { Network } from "@/config/contracts";
import { Resources } from "@/Ponder";

import { createBlockFrontfillQueue } from "./blockFrontfillQueue";

type FrontfillServiceEvents = {
  networkConnected: (arg: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
  }) => void;
  taskFailed: (arg: { network: string; error: Error }) => void;
  newEventsAdded: (arg: {
    network: string;
    blockNumber: number;
    blockTimestamp: number;
    blockTxnCount: number;
    matchedLogCount: number;
  }) => void;
};

export class FrontfillService extends EventEmitter<FrontfillServiceEvents> {
  resources: Resources;

  private frontfillNetworks: {
    network: Network;
    latestBlockNumber: number;
  }[] = [];
  private queueKillFunctions: (() => void)[] = [];

  constructor({ resources }: { resources: Resources }) {
    super();
    this.resources = resources;
  }

  async getLatestBlockNumbers() {
    const frontfillContracts = this.resources.contracts.filter(
      (contract) => contract.endBlock === undefined && contract.isIndexed
    );

    const frontfillNetworkSet = new Set<Network>();
    frontfillContracts.forEach((contract) =>
      frontfillNetworkSet.add(contract.network)
    );

    await Promise.all(
      Array.from(frontfillNetworkSet).map(async (network) => {
        const latestBlockNumber = await this.getLatestBlockForNetwork({
          network,
        });
        this.frontfillNetworks.push({ network, latestBlockNumber });
      })
    );

    frontfillContracts.forEach((contract) => {
      const frontfillNetwork = this.frontfillNetworks.find(
        (n) => n.network.name === contract.network.name
      );
      if (!frontfillNetwork) {
        throw new Error(
          `Frontfill network not found: ${contract.network.name}`
        );
      }
      contract.endBlock = frontfillNetwork.latestBlockNumber;
    });
  }

  startFrontfill() {
    this.frontfillNetworks.forEach((frontfillNetwork) => {
      const { network, latestBlockNumber } = frontfillNetwork;

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
        // Also noticed taht this approach sometimes skips the block
        // immediately after latestBlockNumber.
        if (blockNumber > latestBlockNumber) {
          frontfillQueue.push({ blockNumber });
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
    let latestBlockRequestCount = 0;
    let latestBlockNumber: number | null = null;
    let latestBlockTimestamp: number | null = null;

    while (latestBlockNumber === null || latestBlockTimestamp === null) {
      try {
        const latestBlock = await network.provider.getBlock("latest");
        latestBlockNumber = latestBlock.number;
        latestBlockTimestamp = latestBlock.timestamp;
      } catch (err) {
        this.resources.logger.warn(
          `Failed to fetch latest block for network [${network.name}], retrying...`
        );
        latestBlockRequestCount += 1;
        if (latestBlockRequestCount > 5) {
          this.resources.logger.error(
            `Unable to get latest block after 5 retries:`
          );
          throw err;
        }
      }
    }

    this.emit("networkConnected", {
      network: network.name,
      blockNumber: latestBlockNumber,
      blockTimestamp: latestBlockTimestamp,
    });

    return latestBlockNumber;
  }
}
