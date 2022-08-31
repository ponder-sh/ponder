import { utils } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import { CONFIG } from "../config";
import { chainIdByGraphNetwork } from "../constants";
import {
  Api,
  defaultPonderConfig,
  EvmSource,
  SourceKind,
  Store,
} from "../readUserConfig";
import type { RpcUrlMap } from "./getRpcUrlMap";

interface GraphCompatPonderConfig {
  sources: GraphCompatSource[];
  stores: Store[];
  apis: Api[];
  graphSchemaFilePath: string;
}

interface GraphCompatSource extends EvmSource {
  mappingFilePath: string;
  wasmFilePath: string;
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

const readSubgraphYaml = async (rpcUrlMap: RpcUrlMap) => {
  const subgraphYamlRaw = await readFile(
    CONFIG.GRAPH_COMPAT_SUBGRAPH_YAML_PATH,
    "utf-8"
  );
  const subgraphYaml = parse(subgraphYamlRaw);
  const subgraphSchemaFilePath = path.resolve(subgraphYaml.schema.file);

  const subgraphSources: GraphSource[] = subgraphYaml.dataSources;
  const graphCompatSourcesWithoutAbiInterfaces = subgraphSources.map((source) =>
    getPonderSourceFromGraphSource(source, rpcUrlMap)
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
    graphSchemaFilePath: subgraphSchemaFilePath,
  };

  return config;
};

const getPonderSourceFromGraphSource = (
  subgraphSource: GraphSource,
  rpcUrlMap: RpcUrlMap
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
  const rpcUrl = rpcUrlMap[chainId];
  if (!rpcUrl) {
    throw new Error(`Missing RPC URL for chain ID: ${chainId}`);
  }

  const mappingFilePath = path.resolve(subgraphSource.mapping.file);
  const wasmFilePath = path.resolve(
    `./build/${subgraphSource.name}/${subgraphSource.name}.wasm`
  );

  return {
    kind: SourceKind.EVM,
    name: subgraphSource.name,
    chainId: chainId,
    rpcUrl: rpcUrl,
    address: subgraphSource.source.address,
    abi: sourceAbiPath,
    startBlock: subgraphSource.source.startBlock,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    abiInterface: null!,
    mappingFilePath: mappingFilePath,
    wasmFilePath: wasmFilePath,
    eventHandlers: subgraphSource.mapping.eventHandlers || [],
  };
};

export { readSubgraphYaml };
export type { GraphCompatPonderConfig };
