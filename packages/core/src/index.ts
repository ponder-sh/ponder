export { createConfig } from "@/config/config.js";
export { createSchema } from "@/schema/schema.js";
export type { Block, Log, Transaction } from "@/types/eth.js";
export type { Virtual } from "@/types/virtual.js";
export {
  type MergeAbis,
  mergeAbis,
  loadBalance,
  rateLimit,
} from "@ponder/utils";

import type { Config } from "@/config/config.js";
import type { Prettify } from "./types/utils.js";

export type ContractConfig = Prettify<Config["contracts"][string]>;
export type NetworkConfig = Prettify<Config["networks"][string]>;
export type BlockConfig = Prettify<Config["blocks"][string]>;
export type DatabaseConfig = Prettify<Config["database"]>;

export { graphQLMiddleware } from "@/graphql/middleware.js";
