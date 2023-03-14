import { Abi, Address } from "abitype";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, http, PublicClient } from "viem";
import { mainnet } from "viem/chains";

import { PonderOptions } from "@/config/options";
import { ResolvedPonderConfig } from "@/config/ponderConfig";

export type Network = {
  name: string;
  chainId: number;
  client: PublicClient;
  rpcUrl?: string;
  pollingInterval?: number;
};

export type Contract = {
  name: string;
  address: Address;
  network: Network;

  abi: Abi;
  abiFilePath?: string;

  startBlock: number;
  endBlock?: number;
  blockLimit: number;

  isIndexed: boolean;
};

const clients: Record<number, PublicClient | undefined> = {};

export function buildContracts({
  config,
  options,
}: {
  config: ResolvedPonderConfig;
  options: PonderOptions;
}): Contract[] {
  return config.contracts.map((contract) => {
    const address = contract.address.toLowerCase() as Address;

    let abiFilePath: string | undefined;
    let abiObject: any;

    // Get the contract ABI.
    if (typeof contract.abi === "string") {
      // If it's a string, assume it's a file path.
      abiFilePath = path.isAbsolute(contract.abi)
        ? contract.abi
        : path.join(
            path.dirname(options.PONDER_CONFIG_FILE_PATH),
            contract.abi
          );

      const abiString = readFileSync(abiFilePath, "utf-8");
      abiObject = JSON.parse(abiString);
    } else {
      // If it's not a string, assume it's the ABI itself.
      abiObject = contract.abi;
    }

    // Handle the case where the ABI is actually the `abi` property of an object. Hardhat emits ABIs like this.
    const abi: Abi = abiObject?.abi ? abiObject.abi : abiObject;

    // Get the contract network/provider.
    const network = config.networks.find((n) => n.name === contract.network);
    if (!network) {
      throw new Error(
        `Network [${contract.network}] not found for contract: ${contract.name}`
      );
    }

    let client = clients[network.chainId];

    if (!client) {
      client = createPublicClient({
        transport: http(network.rpcUrl),
        chain: {
          ...mainnet,
          name: network.name,
          id: network.chainId,
          network: network.name,
        },
      });
      clients[network.chainId] = client;
    }

    const resolvedNetwork: Network = {
      name: network.name,
      chainId: network.chainId,
      client,
      rpcUrl: network.rpcUrl,
      pollingInterval: network.pollingInterval,
    };

    return {
      name: contract.name,
      address,

      network: resolvedNetwork,

      abi,
      abiFilePath: abiFilePath,

      startBlock: contract.startBlock || 0,
      endBlock: contract.endBlock,
      blockLimit:
        contract.blockLimit || getDefaultBlockLimitForNetwork(resolvedNetwork),

      isIndexed: contract.isIndexed !== undefined ? contract.isIndexed : true,
    };
  });
}

function getDefaultBlockLimitForNetwork(network: Network) {
  // Quicknode enforces a hard limit of 10_000.
  if (network.rpcUrl !== undefined && network.rpcUrl.includes("quiknode.pro")) {
    return 10_000;
  }

  // Otherwise (e.g. Alchemy) use an optimistically high block limit and lean
  // on the error handler to resolve failures.

  let blockLimit: number;
  switch (network.chainId) {
    // Mainnet.
    case 1:
    case 3:
    case 4:
    case 5:
    case 42:
    case 11155111:
      blockLimit = 2_000;
      break;
    // Optimism.
    case 10:
    case 420:
      blockLimit = 50_000;
      break;
    // Polygon.
    case 137:
    case 80001:
      blockLimit = 50_000;
      break;
    // Arbitrum.
    case 42161:
    case 421613:
      blockLimit = 50_000;
      break;
    default:
      blockLimit = 50_000;
  }

  return blockLimit;
}
