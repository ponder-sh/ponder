// https://github.com/graphprotocol/graph-node/blob/master/docs/subgraph-manifest.md
export type GraphSource = {
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
      file: any;
    }[];
    eventHandlers?: {
      event: string;
      handler: string;
      topic0?: string;
    }[];
    // NOTE: Not planning to support callHandlers or blockHandlers.
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

export const validateGraphProtocolSource = (source: unknown): GraphSource => {
  return source as GraphSource;
};
