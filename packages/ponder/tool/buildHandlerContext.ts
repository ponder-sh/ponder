import { Contract } from "ethers";
import { Knex } from "knex";

import type { DbSchema } from "./createDbSchema";
import { db } from "./db";
import { getProviderForSource } from "./helpers";
import type { PonderConfig } from "./readUserConfig";
import { SourceKind } from "./readUserConfig";

type HandlerContext = {
  entities: {
    [key: string]: Knex.QueryBuilder<Record<string, unknown>> | undefined;
  };
  contracts: {
    [key: string]: Contract | undefined;
  };
};

const buildHandlerContext = (
  config: PonderConfig,
  dbSchema: DbSchema
): HandlerContext => {
  const entityNames = dbSchema.tables.map((table) => table.name);
  const sources = config.sources.filter(
    (source) => source.kind === SourceKind.EVM
  );

  const entities: {
    [key: string]: Knex.QueryBuilder<Record<string, unknown>> | undefined;
  } = {};
  entityNames.forEach((entityName) => {
    entities[entityName] = db<Record<string, unknown>>(entityName);
  });

  const contracts: { [key: string]: Contract | undefined } = {};
  sources.forEach((source) => {
    const provider = getProviderForSource(config, source);
    const contract = new Contract(
      source.address,
      source.abiInterface,
      provider
    );
    contracts[source.name] = contract;
  });

  return {
    entities: entities,
    contracts: contracts,
  };
};

export { buildHandlerContext };
export type { HandlerContext };
