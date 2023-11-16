import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Abi } from "abitype";
import prettier from "prettier";
import { parse } from "yaml";

import { getGraphProtocolChainId } from "@/helpers/getGraphProtocolChainId.js";
import { validateGraphProtocolSource } from "@/helpers/validateGraphProtocolSource.js";
import type {
  SerializableConfig,
  SerializableContract,
  SerializableNetwork,
} from "@/index.js";

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
  const ponderNetworks: SerializableNetwork[] = [];
  let ponderContracts: SerializableContract[] = [];

  // Fetch the manifest file.
  const manifestRaw = await fetchIpfsFile(subgraphId);
  const manifest = parse(manifestRaw);

  // Fetch and write the schema.graphql file.
  const schemaCid = manifest.schema.file["/"].slice(6);
  const schemaRaw = await fetchIpfsFile(schemaCid);
  const schemaCleaned =
    '# This is a copy of the subgraph schema for reference, but is not being used by Ponder. Please complete the schema in "ponder.schema.ts". \n' +
    schemaRaw
      .replaceAll(": ID!", ": String!")
      .replaceAll("BigDecimal", "Float");
  const ponderSchemaFilePath = path.join(rootDir, "schema.graphql");
  writeFileSync(
    ponderSchemaFilePath,
    await prettier.format(schemaCleaned, { parser: "graphql" }),
  );

  const dataSources = (manifest.dataSources as unknown[]).map(
    validateGraphProtocolSource,
  );

  const abiMap: Record<string, Abi> = {};

  // Fetch and write all referenced ABIs.
  const abiFiles = dataSources
    .map((source) => source.mapping.abis)
    .flat()
    .filter(
      (source, idx, arr) =>
        arr.findIndex((s) => s.name === source.name) === idx,
    );
  await Promise.all(
    abiFiles.map(async (abi) => {
      const abiContent = await fetchIpfsFile(abi.file["/"].slice(6));
      const abiPath = path.join(rootDir, `./abis/${abi.name}.json`);

      const abiParsed = JSON.parse(abiContent) as Abi;
      abiMap[abi.name] = abiParsed;

      writeFileSync(
        abiPath,
        await prettier.format(
          `export const ${abi.name}Abi = ${abiContent} as const`,
          {
            parser: "typescript",
          },
        ),
      );
    }),
  );

  // Build the ponder sources.
  ponderContracts = dataSources.map((source) => {
    const network = source.network || "mainnet";
    const chainId = getGraphProtocolChainId(network);
    if (!chainId || chainId === -1) {
      throw new Error(`Unhandled network name: ${network}`);
    }

    if (!ponderNetworks.map((n) => n.name).includes(network)) {
      ponderNetworks.push({
        name: network,
        chainId: chainId,
        transport: `http(process.env.PONDER_RPC_URL_${chainId})`,
      });
    }

    const abiRelativePath = `./abis/${source.source.abi}Abi.ts`;

    return {
      name: source.name,
      network: [{ name: network }],
      address: source.source.address,
      abi: {
        dir: abiRelativePath,
        name: source.source.abi,
        abi: abiMap[source.source.abi],
      },
      startBlock: source.source.startBlock,
    } satisfies SerializableContract;
  });

  return {
    networks: ponderNetworks,
    contracts: ponderContracts,
  } satisfies SerializableConfig;
};
