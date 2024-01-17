import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SerializableConfig } from "@/index.js";
import pico from "picocolors";
import prettier from "prettier";
import { parse } from "yaml";

import { getGraphProtocolChainId } from "./helpers/getGraphProtocolChainId.js";
import {
  GraphSource,
  validateGraphProtocolSource,
} from "./helpers/validateGraphProtocolSource.js";

const fetchIpfsFile = async (cid: string) => {
  const url = `https://ipfs.network.thegraph.com/api/v0/cat?arg=${cid}`;
  const response = await fetch(url);
  const contentRaw = await response.text();
  return contentRaw;
};

export const fromSubgraphId = async ({
  rootDir,
  subgraphId,
}: {
  rootDir: string;
  subgraphId: string;
}) => {
  // Fetch the manifest file.
  const manifestRaw = await fetchIpfsFile(subgraphId);

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

  if (manifest.templates?.length > 0) {
    console.log(
      pico.yellow(
        "\r\nDetected a factory pattern, which cannot be imported from Subgraph. See https://ponder.sh/docs/guides/add-contracts#factory-contracts for how to add them manually.",
      ),
    );
  }

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
      const abiContent = await fetchIpfsFile(abi.file["/"].slice(6));
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
    const chainId = getGraphProtocolChainId(network);
    if (!chainId || chainId === -1) {
      throw new Error(`Unhandled network name: ${network}`);
    }
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
    contractsObject[pc.name] = pc;
    networksObject[pc.network] = {
      chainId: getGraphProtocolChainId(pc.network),
      transport: `http(process.env.PONDER_RPC_URL_${getGraphProtocolChainId(
        pc.network,
      )})`,
    };
    contractsObject[pc.name].name = undefined;
  });

  const config: SerializableConfig = {
    networks: networksObject,
    contracts: contractsObject,
  };

  return config;
};
