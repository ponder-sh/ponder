export { createConfig } from "@/config/config.js";
export type {
  Block,
  Log,
  Transaction,
  TransactionReceipt,
} from "@/types/eth.js";
export type { Virtual } from "@/types/virtual.js";
export {
  type MergeAbis,
  type ReplaceBigInts,
  mergeAbis,
  loadBalance,
  rateLimit,
  replaceBigInts,
} from "@ponder/utils";

import type { Config } from "@/config/config.js";
import type { Prettify } from "./types/utils.js";

export type ContractConfig = Prettify<Config["contracts"][string]>;
export type NetworkConfig = Prettify<Config["networks"][string]>;
export type BlockConfig = Prettify<Config["blocks"][string]>;
export type DatabaseConfig = Prettify<Config["database"]>;

// export { graphql } from "@/graphql/index.js";
