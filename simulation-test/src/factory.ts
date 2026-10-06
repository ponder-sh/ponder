import type { Factory } from "@ponder/internal/types.js";
import { PONDER_SYNC_SCHEMA } from "@ponder/sync-store/schema.js";
import { type SQL, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Address } from "viem";
import { EMPTY_FACTORY_ADDRESS } from "../apps/super-assessment/constants.js";

/**
 * Copies the factory child addresses and `factory_log` intervals of the template database
 * into the "sim" schema.
 *
 * Note: The expected tables get factory child addresses from this copy, made before the app
 * runs. They do not use the factory key of the app, so a bug in how the app keys or reuses
 * child addresses causes a validation failure.
 */
export const copyTemplateFactoryData = async (db: NodePgDatabase) => {
  await db.execute(sql.raw("CREATE SCHEMA sim"));
  await db.execute(
    sql.raw(
      `CREATE TABLE sim.child_addresses AS
        SELECT factories.fragment_id, factory_addresses.chain_id, factory_addresses.address, factory_addresses.block_number
        FROM "${PONDER_SYNC_SCHEMA}".factories
        JOIN "${PONDER_SYNC_SCHEMA}".factory_addresses ON factory_addresses.factory_id = factories.id`,
    ),
  );
  await db.execute(
    sql.raw(
      `CREATE TABLE sim.factory_intervals AS
        SELECT fragment_id, blocks FROM "${PONDER_SYNC_SCHEMA}".intervals
        WHERE starts_with(fragment_id, 'factory_log_')`,
    ),
  );
};

/** Returns the `factory_log` fragment ID of `parent`, without the factory range. */
const getFactoryLogPrefix = (factory: Factory, parent: Address) =>
  `factory_log_${factory.chainId}_${parent}_${factory.eventSelector}_${factory.childAddressLocation}_`;

/** Returns the parents of `factory`, without parents that emit no logs. */
const getFactoryParents = (factory: Factory): Address[] => {
  if (factory.address === undefined) {
    throw new Error("Factory without an address is not supported");
  }
  const parents = Array.isArray(factory.address)
    ? factory.address
    : [factory.address];
  return parents.filter((parent) => parent !== EMPTY_FACTORY_ADDRESS);
};

/**
 * Returns a query for the child addresses of `factory` from the copy of the template, with
 * the earliest block number of each child. The query matches the `factory_log` fragments of
 * each parent for any factory range, then filters by the range of `factory`.
 *
 * @param parent Only use the children of this parent.
 */
export const getExpectedChildAddresses = (
  factory: Factory,
  parent?: Address,
): SQL => {
  const prefixes = getFactoryParents(factory)
    .filter((_parent) => parent === undefined || _parent === parent)
    .map((_parent) => getFactoryLogPrefix(factory, _parent));

  return sql`SELECT address, min(block_number) AS block_number FROM sim.child_addresses
    WHERE chain_id = ${factory.chainId}
      AND block_number >= ${factory.fromBlock ?? 0}
      AND block_number <= ${factory.toBlock ?? Number.MAX_SAFE_INTEGER}
      AND EXISTS (
        SELECT 1 FROM unnest(ARRAY[${sql.join(
          prefixes.map((prefix) => sql`${prefix}`),
          sql`, `,
        )}]::text[]) AS prefix
        WHERE starts_with(fragment_id, prefix)
      )
    GROUP BY address`;
};

/**
 * Returns the parents of `factory` whose child addresses the template does not have for
 * the full factory range.
 */
export const getMissingExpectedParents = async (
  db: NodePgDatabase,
  factory: Factory,
): Promise<Address[]> => {
  const missing: Address[] = [];

  for (const parent of getFactoryParents(factory)) {
    const result = await db.execute(
      sql`SELECT coalesce(range_agg(blocks), '{}') @> numrange(${factory.fromBlock ?? 0}, ${(factory.toBlock ?? Number.MAX_SAFE_INTEGER) + 1}, '[]') AS covered
        FROM (
          SELECT unnest(blocks) AS blocks FROM sim.factory_intervals
          WHERE starts_with(fragment_id, ${getFactoryLogPrefix(factory, parent)})
        ) AS unnested`,
    );

    if (result.rows[0]!.covered !== true) missing.push(parent);
  }

  return missing;
};
