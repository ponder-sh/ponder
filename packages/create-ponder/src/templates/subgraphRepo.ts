import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prettier from "prettier";
import { http } from "viem";
import { parse } from "yaml";

import {
  getGraphProtocolChainId,
  subgraphYamlFileNames,
} from "@/helpers/getGraphProtocolChainId";
import { validateGraphProtocolSource } from "@/helpers/validateGraphProtocolSource";
import type { Contract, Network, PartialConfig } from "@/index";

export const fromSubgraphRepo = ({
  rootDir,
  subgraphPath,
}: {
  rootDir: string;
  subgraphPath: string;
}) => {
  const subgraphRootDir = path.resolve(subgraphPath);

  const ponderNetworks: Network[] = [];
  let ponderContracts: Contract[] = [];

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
  const schemaRaw = readFileSync(
    path.join(subgraphRootDirPath, subgraphYaml.schema.file),
    {
      encoding: "utf-8",
    }
  );
  const schemaCleaned = schemaRaw
    .replaceAll(": ID!", ": String!")
    .replaceAll("BigDecimal", "Float");
  writeFileSync(
    path.join(rootDir, "schema.graphql"),
    prettier.format(schemaCleaned, { parser: "graphql" })
  );

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
          transport: http(`process.env.PONDER_RPC_URL_${chainId}`),
        });
      }

      // Copy the ABI file.
      const abiAbsolutePath = path.join(subgraphRootDirPath, abiPath);
      const abiFileName = path.basename(abiPath);

      const ponderAbiRelativePath = `./abis/${abiFileName}`;
      const ponderAbiAbsolutePath = path.join(rootDir, ponderAbiRelativePath);

      copyFileSync(abiAbsolutePath, ponderAbiAbsolutePath);

      return <Contract>{
        name: source.name,
        network: network,
        address: source.source.address,
        abi: ponderAbiRelativePath,
        startBlock: source.source.startBlock,
      };
    });

  // Build the partial ponder config.
  const config: PartialConfig = {
    networks: ponderNetworks,
    contracts: ponderContracts,
  };

  return config;
};
