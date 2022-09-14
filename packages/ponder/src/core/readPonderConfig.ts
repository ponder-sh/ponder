import { utils } from "ethers";
import { readFileSync } from "node:fs";

import { GraphqlApi } from "@/apis/graphql";
import { CONFIG } from "@/common/config";
import { EvmSource } from "@/sources/evm";
import { SqliteStore } from "@/stores/sqlite";

type PonderConfigFile = {
  sources: {
    kind: string;
    name: string;
    chainId: 1;
    rpcUrl: string;
    abi: string;
    address: string;
    startBlock: number;
  }[];
  stores: {
    kind: string;
    filename: string;
  }[];
  apis: {
    kind: string;
    port: number;
  }[];
};

const readPonderConfig = () => {
  // Load and then remove the module from the require cache, because we are loading
  // it several times in the same process and need the latest version each time.
  // https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rawUserConfig = require(CONFIG.PONDER_CONFIG_FILE_PATH);
  delete require.cache[require.resolve(CONFIG.PONDER_CONFIG_FILE_PATH)];

  // TODO: Validate config kek
  const userConfig = rawUserConfig as PonderConfigFile;

  if (userConfig.apis.length > 1) {
    throw new Error(`Cannot create more than one API`);
  }
  if (userConfig.stores.length > 1) {
    throw new Error(`Cannot create more than one store`);
  }

  // Build sources.
  const sources = userConfig.sources.map((source) => {
    const abiString = readFileSync(source.abi, "utf-8");
    const abiObject = JSON.parse(abiString);
    const abi = abiObject.abi ? abiObject.abi : abiObject;
    const abiInterface = new utils.Interface(abi);

    if (source.rpcUrl === undefined || source.rpcUrl === "") {
      throw new Error(`Invalid or missing RPC URL for source: ${source.name}`);
    }

    return new EvmSource(
      source.name,
      source.chainId,
      source.rpcUrl,
      source.address,
      source.abi,
      abiInterface,
      source.startBlock
    );
  });

  // Build store.
  const store = new SqliteStore();

  // Build API.
  const port = userConfig.apis[0].port;
  const api = new GraphqlApi(port, store);

  return {
    sources,
    store,
    api,
  };
};

export { readPonderConfig };
