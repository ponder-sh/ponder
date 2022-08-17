import { utils } from "ethers";
import { readFile } from "node:fs/promises";

import { CONFIG } from "./config";

const { userConfigFile } = CONFIG;

enum SourceKind {
  EVM = "evm",
}
type EvmSource = {
  kind: SourceKind.EVM;
  name: string;
  chainId: number;
  rpcUrl: string;
  address: string;
  abi: string;
  startBlock?: number;
  // NOTE: this property doesn't actually exist on the raw source
  // read in from the file, but adding it here for type simplicity.
  abiInterface: utils.Interface;
};
type Source = EvmSource;

// TODO: Make stores an actual abstraction / thing
enum StoreKind {
  SQL = "sql",
}
type SqlStore = {
  kind: StoreKind.SQL;
  client: "sqlite3";
  connection: {
    filename: "inmemory";
  };
};
type Store = SqlStore;

enum ApiKind {
  GQL = "graphql",
}
type GraphqlApi = {
  kind: ApiKind.GQL;
  port: number;
};
type Api = GraphqlApi;

interface PonderConfig {
  sources: Source[];
  stores: Store[];
  apis: Api[];
}

const readUserConfig = async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const userConfig = require(userConfigFile);

  // Remove the ponder.config.js module from the require cache after reading,
  // because we are loading it several times in the same process
  // and we need the latest version each time.
  // https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
  delete require.cache[require.resolve(userConfigFile)];

  // TODO: Validate config kek
  const validatedUserConfig = userConfig as PonderConfig;

  // Parse ABI files and add interfaces to the config object.
  const sourcesWithAbiInterfaces = await Promise.all(
    validatedUserConfig.sources.map(async (source) => {
      const abiString = await readFile(source.abi, "utf-8");
      const abiObject = JSON.parse(abiString).abi;
      return { ...source, abiInterface: new utils.Interface(abiObject) };
    })
  );

  const config: PonderConfig = {
    ...validatedUserConfig,
    sources: sourcesWithAbiInterfaces,
  };

  return config;
};

export { readUserConfig, SourceKind, StoreKind };
export type { EvmSource, PonderConfig, SqlStore };
