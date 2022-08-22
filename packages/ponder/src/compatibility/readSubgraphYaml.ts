import { utils } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import { CONFIG } from "../config";
import {
  Api,
  defaultPonderConfig,
  EvmSource,
  SourceKind,
  Store,
} from "../readUserConfig";

interface GraphCompatPonderConfig {
  sources: GraphCompatSource[];
  stores: Store[];
  apis: Api[];
}

interface GraphCompatSource extends EvmSource {
  mappingFilePath: string;
  eventHandlers: {
    event: string;
    handler: string;
  }[];
}

// https://github.com/graphprotocol/graph-node/blob/master/docs/subgraph-manifest.md
type GraphSource = {
  kind: string; // Should be "ethereum"
  name: string;
  network: string;
  source: {
    address: string;
    abi: string; // Keys into dataSource.mapping.abis
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
    eventHandlers?: {
      event: string;
      handler: string;
      topic0?: string;
    }[];
    // NOTE: Not planning to support callHandlers or blockHandlers in initial release.
    // callHandlers?: {
    //   function: string;
    //   handler: string;
    // }[];
    // blockHandlers?: {
    //   handler: string;
    //   filter?: {
    //     kind: string;
    //   };
    // }[];
    file: string; // relative path to file that contains handlers for this source
  };
};

// https://github.com/graphprotocol/graph-cli/blob/main/src/protocols/index.js#L40
// https://chainlist.org/
const chainIdByGraphNetwork: Record<string, number | undefined> = {
  mainnet: 1,
  kovan: 42,
  rinkeby: 4,
  ropsten: 3,
  goerli: 5,
  "poa-core": 99,
  "poa-sokol": 77,
  xdai: 100,
  matic: 137,
  mumbai: 80001,
  fantom: 250,
  "fantom-testnet": 4002,
  bsc: 56,
  chapel: -1,
  clover: 0,
  avalanche: 43114,
  fuji: 43113,
  celo: 42220,
  "celo-alfajores": 44787,
  fuse: 122,
  moonbeam: 1284,
  moonriver: 1285,
  mbase: -1,
  "arbitrum-one": 42161,
  "arbitrum-rinkeby": 421611,
  optimism: 10,
  "optimism-kovan": 69,
  aurora: 1313161554,
  "aurora-testnet": 1313161555,
};

const getPonderSourceFromGraphSource = (
  subgraphSource: GraphSource
): GraphCompatSource => {
  const sourceAbi = subgraphSource.mapping.abis.find(
    (abi) => abi.name === subgraphSource.name
  );
  if (!sourceAbi) {
    throw new Error(`ABI path not found for source: ${subgraphSource.name}`);
  }
  const sourceAbiPath = path.resolve(sourceAbi.file);

  const chainId = chainIdByGraphNetwork[subgraphSource.network];
  if (!chainId || chainId === -1) {
    throw new Error(`Unhandled network name: ${subgraphSource.network}`);
  }

  const mappingFilePath = path.resolve(subgraphSource.mapping.file);

  return {
    kind: SourceKind.EVM,
    name: subgraphSource.name,
    chainId: chainId,
    rpcUrl: "1",
    address: subgraphSource.source.address,
    abi: sourceAbiPath,
    startBlock: subgraphSource.source.startBlock,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    abiInterface: null!,
    mappingFilePath: mappingFilePath,
    eventHandlers: subgraphSource.mapping.eventHandlers || [],
  };
};

const readSubgraphYaml = async () => {
  const subgraphYamlRaw = await readFile(
    CONFIG.GRAPH_COMPAT_SUBGRAPH_YAML_PATH,
    "utf-8"
  );
  const subgraphYaml = parse(subgraphYamlRaw);
  const subgraphSchemaFilePath = path.resolve(subgraphYaml.schema.file);

  const subgraphSources: GraphSource[] = subgraphYaml.dataSources;
  const graphCompatSourcesWithoutAbiInterfaces = subgraphSources.map(
    getPonderSourceFromGraphSource
  );

  // Parse ABI files and add interfaces to the config object.
  const graphCompatSources = await Promise.all(
    graphCompatSourcesWithoutAbiInterfaces.map(async (source) => {
      const abiString = await readFile(source.abi, "utf-8");
      const abiObject = JSON.parse(abiString);
      const abi = abiObject.abi ? abiObject.abi : abiObject;
      return { ...source, abiInterface: new utils.Interface(abi) };
    })
  );

  const config: GraphCompatPonderConfig = {
    ...defaultPonderConfig,
    sources: graphCompatSources,
  };

  return {
    graphCompatPonderConfig: config,
    graphSchemaFilePath: subgraphSchemaFilePath,
  };
};

export { readSubgraphYaml };
export type { GraphCompatPonderConfig };
