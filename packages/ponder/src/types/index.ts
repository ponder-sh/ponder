import type { utils } from "ethers";
import type { GraphQLEnumType, GraphQLObjectType } from "graphql";

// Ponder config types
export enum SourceKind {
  EVM = "evm",
}

export type EvmSource = {
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

export type Source = EvmSource;

// TODO: Make stores an actual abstraction / thing
export enum StoreKind {
  SQL = "sql",
}

export type SqlStore = {
  kind: StoreKind.SQL;
  client: "sqlite3";
  connection: {
    filename: ":memory:";
  };
};

export type Store = SqlStore;

export enum ApiKind {
  GQL = "graphql",
}

export type GraphqlApi = {
  kind: ApiKind.GQL;
  port: number;
};

export type Api = GraphqlApi;

export type PonderConfig = {
  sources: Source[];
  stores: Store[];
  apis: Api[];
};

// SQL database types

export type DbSchema = {
  tables: DbTable[];
  userDefinedTypes: {
    [key: string]: GraphQLObjectType | GraphQLEnumType | undefined;
  };
};

export type DbTable = {
  name: string;
  columns: DbColumn[];
};

export type DbColumn = {
  name: string;
  type: string;
  notNull: boolean;
};
