import { OPTIONS } from "@/common/options";
import type { ResolvedPonderPlugin } from "@/plugin";

export type PonderConfig = {
  database: {
    kind: "sqlite" | "postgres";
    filename?: string;
  };
  networks: {
    kind?: string;
    name: string;
    chainId: number;
    rpcUrl: string;
  }[];
  sources: {
    kind?: string;
    name: string;
    network: string;
    abi: string;
    address: string;
    startBlock?: number;
    pollingInterval?: number;
    blockLimit?: number;
  }[];
  plugins: ResolvedPonderPlugin[];
};

export const readPonderConfig = () => {
  // Load and then remove the module from the require cache, because we are loading
  // it several times in the same process and need the latest version each time.
  // https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rawConfig = require(OPTIONS.PONDER_CONFIG_FILE_PATH);
  delete require.cache[require.resolve(OPTIONS.PONDER_CONFIG_FILE_PATH)];

  // TODO: Validate config kek
  const config = rawConfig as PonderConfig;

  return config;
};
