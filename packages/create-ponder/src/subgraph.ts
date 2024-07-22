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

type SubgraphProvider = {
  id: string;
  name: string;
  getUrl: (cid: string) => string;
};

export const subgraphProviders = [
  {
    id: "thegraph",
    name: "The Graph",
    getUrl: (cid) => `https://ipfs.network.thegraph.com/api/v0/cat?arg=${cid}`,
  },
  {
    id: "satsuma",
    name: "Alchemy Subgraph (Satsuma)",
    getUrl: (cid) => `https://ipfs.satsuma.xyz/ipfs/${cid}`,
  },
] as const satisfies readonly SubgraphProvider[];

export type SubgraphProviderIds = (typeof subgraphProviders)[number]["id"];

const fetchIpfsFile = async (cid: string, provider: SubgraphProvider) => {
  const url = provider.getUrl(cid);
  const response = await fetch(url);
  const contentRaw = await response.text();
  return contentRaw;
};

export const fromSubgraphId = async ({
  rootDir,
  subgraphId,
  providerId = "thegraph",
}: {
  rootDir: string;
  subgraphId: string;
  providerId?: SubgraphProviderIds;
}) => {
  // Find provider
  const provider = subgraphProviders.find((p) => p.id === providerId);
  if (!provider) throw new Error(`Unknown subgraph provider: ${providerId}`);

  // Fetch the manifest file.
  const manifestRaw = await fetchIpfsFile(subgraphId, provider);

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
      const abiContent = await fetchIpfsFile(abi.file["/"].slice(6), provider);
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
