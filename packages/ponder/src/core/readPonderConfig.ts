import Sqlite from "better-sqlite3";
import { utils } from "ethers";
import { readFileSync } from "node:fs";

import { GraphqlApi } from "@/apis/graphql";
import { CONFIG } from "@/common/config";
import { logger } from "@/common/logger";
import { EvmSource } from "@/sources/evm";
import { SqliteCacheStore } from "@/stores/sqliteCacheStore";
import { SqliteEntityStore } from "@/stores/sqliteEntityStore";

type PonderConfigFile = {
  database: {
    kind: string;
    filename?: string;
  };
  sources: {
    kind: string;
    name: string;
    chainId: 1;
    rpcUrl: string;
    abi: string;
    address: string;
    startBlock: number;
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
  const defaultDbFilePath = `./.ponder/cache.db`;
  const db = Sqlite(userConfig.database.filename || defaultDbFilePath, {
    verbose: logger.debug,
  });
  const cacheStore = new SqliteCacheStore(db);
  const entityStore = new SqliteEntityStore(db);

  // Build API.
  const port = userConfig.apis[0].port;
  const api = new GraphqlApi(port, entityStore);

  return {
    sources,
    cacheStore,
    entityStore,
    api,
  };
};

export { readPonderConfig };
