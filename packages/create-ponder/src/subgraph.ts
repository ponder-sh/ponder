import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SerializableConfig } from "@/index.js";
import prettier from "prettier";
import { parse } from "yaml";

import { getGraphProtocolChainId } from "./helpers/getGraphProtocolChainId.js";
import {
  type GraphSource,
  validateGraphProtocolSource,
} from "./helpers/validateGraphProtocolSource.js";

export const subgraphProviders = [
  {
    id: "thegraph",
    name: "The Graph",
    // Used to be https://ipfs.network.thegraph.com/api/v0/cat?arg=${cid}
    // Also used to accept GET requests for some reason
    fetchIpfs: async (cid: string) => {
      const response = await fetch(
        `https://api.thegraph.com/ipfs/api/v0/cat?arg=${cid}`,
        { method: "POST" },
      );
      return await response.text();
    },
  },
  {
    id: "satsuma",
    name: "Alchemy Subgraph (Satsuma)",
    fetchIpfs: async (cid: string) => {
      const response = await fetch(`https://ipfs.satsuma.xyz/ipfs/${cid}`);
      return await response.text();
    },
  },
] as const;

type SubgraphProvider = (typeof subgraphProviders)[number];

export type SubgraphProviderId = SubgraphProvider["id"];

export const fromSubgraphId = async ({
  rootDir,
  subgraphId,
  subgraphProvider,
}: {
  rootDir: string;
  subgraphId: string;
  subgraphProvider: SubgraphProviderId;
}) => {
  // Find provider
  const provider = subgraphProviders.find((p) => p.id === subgraphProvider);
  if (!provider)
    throw new Error(`Unknown subgraph provider: ${subgraphProvider}`);

  // Fetch the manifest file.
  const manifestRaw = await provider.fetchIpfs(subgraphId);

  const manifest = parse(manifestRaw);

  const contracts: any = {};

  manifest.dataSources.forEach((d: any) => {
    contracts[d.name] = {
      network: d.network,
      address: d.source.address,
      startBlock: d.source.startBlock,
    };
  });

  const dataSources = manifest.dataSources as GraphSource[];

  mkdirSync(path.join(rootDir, "abis"), { recursive: true });
  mkdirSync(path.join(rootDir, "src"), { recursive: true });

  // Fetch and write all referenced ABIs.
  const abiFiles = dataSources
    .flatMap((source) => validateGraphProtocolSource(source).mapping.abis)
    .filter(
      (source, idx, arr) =>
        arr.findIndex((s) => s.name === source.name) === idx,
    );

  const abis: any = {};

  await Promise.all(
    abiFiles.map(async (abi) => {
      const abiContent = await provider.fetchIpfs(abi.file["/"].slice(6));
      const abiPath = path.join(rootDir, `./abis/${abi.name}Abi.ts`);
      writeFileSync(
        abiPath,
        await prettier.format(
          `export const ${abi.name}Abi = ${abiContent} as const`,
          {
            parser: "typescript",
          },
        ),
      );
      abis[abi.name] = JSON.parse(abiContent);
    }),
  );

  // Build the ponder sources.
  const ponderContracts = dataSources.map((sourceInvalid) => {
    const source = validateGraphProtocolSource(sourceInvalid);
    const network = source.network || "mainnet";
    const abiRelativePath = `./abis/${source.source.abi}Abi.ts`;

    return {
      name: source.name,
      network: network,
      address: source.source.address,
      abi: {
        abi: abis[source.source.abi],
        dir: abiRelativePath,
        name: `${source.source.abi}Abi`,
      },
      startBlock: source.source.startBlock,
    };
  });

  const contractsObject: any = {};
  const networksObject: any = {};

  ponderContracts.forEach((pc) => {
    const chainId = getGraphProtocolChainId(pc.network);
    contractsObject[pc.name] = pc;
    networksObject[pc.network] = {
      chainId,
      transport: `http(process.env.PONDER_RPC_URL_${chainId})`,
    };
    contractsObject[pc.name].name = undefined;
  });

  const config: SerializableConfig = {
    networks: networksObject,
    contracts: contractsObject,
  };

  const warnings = [];
  if (manifest.templates?.length > 0) {
    warnings.push(
      "Factory contract detected. Please see the factory contract documentation for more details: https://ponder.sh/docs/guides/add-contracts#factory-contracts",
    );
  }

  return { config, warnings };
};
