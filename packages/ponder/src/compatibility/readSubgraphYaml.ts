import { utils } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import { CONFIG } from "../config";
import {
  defaultPonderConfig,
  EvmSource,
  PonderConfig,
  SourceKind,
} from "../readUserConfig";

type SubgraphSource = {
  kind: string; // Should be "ethereum"
  name: string;
  network: string;
  source: {
    address: string;
    abi: string; // Keys into the dataSource.mapping.abis
    startBlock?: number;
  };
  mapping: {
    kind: string; // Should be "ethereum/events"
    apiVersion: string;
    language: string; // Should be "wasm/assemblyscript"
    entities: string[]; // Corresponds to entities by name defined in schema.graphql
    abis: {
      name: string;
      file: string;
    }[];
    eventHandlers: {
      event: string;
      handler: string;
    }[];
    file: string; // relative path to file that contains handlers for this source
  };
};

const getPonderSourceFromSubgraphSource = (
  subgraphSource: SubgraphSource
): EvmSource => {
  const sourceAbi = subgraphSource.mapping.abis.find(
    (abi) => abi.name === subgraphSource.name
  );
  if (!sourceAbi) {
    throw new Error(`No ABI defined for source: ${subgraphSource.name}`);
  }
  const sourceAbiPath = path.resolve(sourceAbi.file);

  return {
    kind: SourceKind.EVM,
    name: subgraphSource.name,
    chainId: 1,
    rpcUrl: "1",
    address: subgraphSource.source.address,
    abi: sourceAbiPath,
    startBlock: subgraphSource.source.startBlock,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    abiInterface: null!,
  };
};

const readSubgraphYaml = async () => {
  const subgraphYamlRaw = await readFile(
    CONFIG.GRAPH_COMPAT_SUBGRAPH_YAML_PATH,
    "utf-8"
  );
  const subgraphYaml = parse(subgraphYamlRaw);
  const SUBGRAPH_SCHEMA_FILE = subgraphYaml.schema.file;
  const subgraphSources: SubgraphSource[] = subgraphYaml.dataSources;

  const ponderSources = subgraphSources.map(getPonderSourceFromSubgraphSource);

  console.log({ SUBGRAPH_SCHEMA_FILE, ponderSources });

  // Parse ABI files and add interfaces to the config object.
  const sourcesWithAbiInterfaces = await Promise.all(
    ponderSources.map(async (source) => {
      const abiString = await readFile(source.abi, "utf-8");
      const abiObject = JSON.parse(abiString);
      const abi = abiObject.abi ? abiObject.abi : abiObject;
      return { ...source, abiInterface: new utils.Interface(abi) };
    })
  );

  const config: PonderConfig = {
    ...defaultPonderConfig,
    sources: sourcesWithAbiInterfaces,
  };

  console.log({ config });

  return config;
};

export { readSubgraphYaml };
