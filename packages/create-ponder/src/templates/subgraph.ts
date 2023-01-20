import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  PartialPonderConfig,
  PonderContract,
  PonderNetwork,
} from "src/index";
import { parse } from "yaml";

import type { CreatePonderOptions } from "@/bin/create-ponder";
import {
  getGraphProtocolChainId,
  subgraphYamlFileNames,
} from "@/helpers/getGraphProtocolChainId";
import { validateGraphProtocolSource } from "@/helpers/validateGraphProtocolSource";

export const fromSubgraph = (options: CreatePonderOptions) => {
  if (!options.fromSubgraph) {
    throw new Error(`Internal error: fromSubgraph undefined`);
  }

  const { ponderRootDir } = options;
  const subgraphRootDir = path.resolve(options.fromSubgraph);

  const ponderNetworks: PonderNetwork[] = [];
  let ponderContracts: PonderContract[] = [];

  // If the `--from-subgraph` option was passed, parse subgraph files
  const subgraphRootDirPath = path.resolve(subgraphRootDir);

  // Read and parse the subgraph YAML file.
  let subgraphYamlRaw = "";

  for (const subgraphYamlFileName of subgraphYamlFileNames) {
    try {
      subgraphYamlRaw = readFileSync(
        path.join(subgraphRootDirPath, subgraphYamlFileName),
        {
          encoding: "utf-8",
        }
      );
      break;
    } catch (e) {
      continue;
    }
  }

  if (subgraphYamlRaw === "") {
    throw new Error(`subgraph.yaml file not found`);
  }

  const subgraphYaml = parse(subgraphYamlRaw);

  // Copy over the schema.graphql file.
  const subgraphSchemaFilePath = path.join(
    subgraphRootDirPath,
    subgraphYaml.schema.file
  );
  const ponderSchemaFilePath = path.join(ponderRootDir, "schema.graphql");
  copyFileSync(subgraphSchemaFilePath, ponderSchemaFilePath);

  // Build the ponder sources. Also copy over the ABI files for each source.
  ponderContracts = (subgraphYaml.dataSources as unknown[])
    .map(validateGraphProtocolSource)
    .map((source) => {
      const abiPath = source.mapping.abis.find(
        (abi) => abi.name === source.name
      )?.file;
      if (!abiPath) {
        throw new Error(`ABI path not found for source: ${source.name}`);
      }

      const network = source.network || "mainnet";
      const chainId = getGraphProtocolChainId(network);
      if (!chainId || chainId === -1) {
        throw new Error(`Unhandled network name: ${network}`);
      }

      if (!ponderNetworks.map((n) => n.name).includes(network)) {
        ponderNetworks.push({
          name: network,
          chainId: chainId,
          rpcUrl: `process.env.PONDER_RPC_URL_${chainId}`,
        });
      }

      // Copy the ABI file.
      const abiAbsolutePath = path.join(subgraphRootDirPath, abiPath);
      const abiFileName = path.basename(abiPath);

      const ponderAbiRelativePath = `./abis/${abiFileName}`;
      const ponderAbiAbsolutePath = path.join(
        ponderRootDir,
        ponderAbiRelativePath
      );

      copyFileSync(abiAbsolutePath, ponderAbiAbsolutePath);

      return <PonderContract>{
        name: source.name,
        network: network,
        address: source.source.address,
        abi: ponderAbiRelativePath,
        startBlock: source.source.startBlock,
      };
    });

  // Build the partial ponder config.
  const ponderConfig: PartialPonderConfig = {
    plugins: ["graphqlPlugin()"],
    database: {
      kind: "sqlite",
    },
    networks: ponderNetworks,
    contracts: ponderContracts,
  };

  return ponderConfig;
};
