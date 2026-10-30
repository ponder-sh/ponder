import {
  and,
  eq,
  getTableColumns,
  getTableName,
  getViewName,
  inArray,
  lte,
  type SQL,
  sql,
  type Table,
  type View,
} from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getColumnCasing, getReorgTable } from "@/drizzle/kit/index.js";
import {
  getLiveQueryChannelName,
  getLiveQueryNotifyProcedureName,
  getLiveQueryNotifyProcedureSql,
  getLiveQueryNotifyTriggerName,
  getLiveQueryProcedureName,
  getLiveQueryTempTableName,
  getLiveQueryTriggerName,
  getPartitionName,
  getReorgProcedureName,
  getReorgTableName,
  getReorgTriggerName,
  getViewsLiveQueryNotifyTriggerName,
} from "@/drizzle/onchain.js";
import type {
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { decodeCheckpoint, MAX_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import type { DbClient, QueryOptions } from "./db.js";
import {
  getPonderCheckpointTable,
  PONDER_CHECKPOINT_TABLE_NAME,
  PONDER_META_TABLE_NAME,
} from "./index.js";

export const createIndexes = (
  client: DbClient,
  { statements }: { statements: SchemaBuild["statements"] },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    for (const statement of statements.indexes.sql) {
      yield* client.transaction(
        (tx) =>
          Effect.gen(function* () {
            // 60 minutes
            yield* tx.query((tx) =>
              tx.execute("SET statement_timeout = 3600000;"),
            );
            yield* tx.query((tx) => tx.execute(statement));
          }),
        { label: "create_indexes", ...context },
      );
    }
  });

export const createTriggers = (
  client: DbClient,
  { tables, chainId }: { tables: Table[]; chainId?: number },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* Effect.forEach(
            tables,
            (table) =>
              Effect.gen(function* () {
                const schema = getTableConfig(table).schema ?? "public";
                const columns = getTableColumns(table);

                const columnNames = Object.values(columns).map(
                  (column) => `"${getColumnCasing(column, "snake_case")}"`,
                );

                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `
  CREATE OR REPLACE FUNCTION "${schema}".${getReorgProcedureName(table)}
  RETURNS TRIGGER AS $$
  BEGIN
  IF TG_OP = 'INSERT' THEN
  INSERT INTO "${schema}"."${getReorgTableName(table)}" (${columnNames.join(",")}, operation, checkpoint)
  VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${MAX_CHECKPOINT_STRING}');
  ELSIF TG_OP = 'UPDATE' THEN
  INSERT INTO "${schema}"."${getReorgTableName(table)}" (${columnNames.join(",")}, operation, checkpoint)
  VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${MAX_CHECKPOINT_STRING}');
  ELSIF TG_OP = 'DELETE' THEN
  INSERT INTO "${schema}"."${getReorgTableName(table)}" (${columnNames.join(",")}, operation, checkpoint)
  VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 2, '${MAX_CHECKPOINT_STRING}');
  END IF;
  RETURN NULL;
  END;
  $$ LANGUAGE plpgsql`,
                    ),
                  { label: "create_trigger" },
                );

                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `
  CREATE OR REPLACE TRIGGER "${getReorgTriggerName()}"
  AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"
  FOR EACH ROW EXECUTE PROCEDURE "${schema}".${getReorgProcedureName(table)};
  `,
                    ),
                  { label: "create_trigger" },
                );
              }),
            { concurrency: "unbounded", discard: true },
          );
        }),
      context,
    );
  });

export const dropTriggers = (
  client: DbClient,
  { tables, chainId }: { tables: Table[]; chainId?: number },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* Effect.forEach(
            tables,
            (table) =>
              Effect.gen(function* () {
                const schema = getTableConfig(table).schema ?? "public";

                yield* tx.query(
                  (tx) =>
                    tx.execute(
                      `DROP TRIGGER IF EXISTS "${getReorgTriggerName()}" ON "${schema}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"`,
                    ),
                  { label: "drop_trigger" },
                );
              }),
            { concurrency: "unbounded", discard: true },
          );
        }),
      context,
    );
  });

export const createLiveQueryTriggers = (
  client: DbClient,
  {
    namespaceBuild,
    tables,
    chainId,
  }: { namespaceBuild: NamespaceBuild; tables: Table[]; chainId?: number },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          const notifyProcedure = getLiveQueryNotifyProcedureName();
          const notifyTrigger = getLiveQueryNotifyTriggerName();

          yield* tx.query((tx) =>
            tx.execute(
              `
CREATE OR REPLACE TRIGGER "${notifyTrigger}"
AFTER INSERT OR UPDATE OR DELETE ON "${namespaceBuild.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}"
FOR EACH STATEMENT EXECUTE PROCEDURE "${namespaceBuild.schema}".${notifyProcedure};`,
            ),
          );

          const trigger = getLiveQueryTriggerName();
          const procedure = getLiveQueryProcedureName();

          for (const table of tables) {
            const schema = getTableConfig(table).schema ?? "public";

            // Note: Because the realtime indexing store writes to the parent table, we create the trigger on
            // the parent table instead of the partition table.
            yield* tx.query((tx) =>
              tx.execute(
                `
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"
FOR EACH ROW EXECUTE PROCEDURE "${schema}".${procedure};`,
              ),
            );
          }
        }),
      context,
    );
  });

export const dropLiveQueryTriggers = (
  client: DbClient,
  {
    namespaceBuild,
    tables,
    chainId,
  }: { namespaceBuild: NamespaceBuild; tables: Table[]; chainId?: number },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          const notifyTrigger = getLiveQueryNotifyTriggerName();
          yield* tx.query((tx) =>
            tx.execute(
              `DROP TRIGGER IF EXISTS "${notifyTrigger}" ON "${namespaceBuild.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}";`,
            ),
          );

          const trigger = getLiveQueryTriggerName();
          for (const table of tables) {
            const schema = getTableConfig(table).schema ?? "public";

            yield* tx.query((tx) =>
              tx.execute(
                `DROP TRIGGER IF EXISTS "${trigger}" ON "${schema}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}";`,
              ),
            );
          }
        }),
      context,
    );
  });

export const createLiveQueryProcedures = (
  client: DbClient,
  { namespaceBuild }: { namespaceBuild: NamespaceBuild },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          const schema = namespaceBuild.schema;
          const procedure = getLiveQueryProcedureName();

          yield* tx.query(
            (tx) =>
              tx.execute(
                `
CREATE OR REPLACE FUNCTION "${schema}".${procedure}
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ${getLiveQueryTempTableName()} (table_name)
  VALUES (TG_TABLE_NAME)
  ON CONFLICT (table_name) DO NOTHING;
  RETURN NULL;
END;
$$;`,
              ),
            context,
          );

          const channel = getLiveQueryChannelName(namespaceBuild.schema);

          yield* tx.query(
            (tx) =>
              tx.execute(getLiveQueryNotifyProcedureSql({ schema, channel })),
            context,
          );
        }),
      context,
    );
  });

export const createViews = (
  client: DbClient,
  {
    tables,
    views,
    namespaceBuild,
  }: { tables: Table[]; views: View[]; namespaceBuild: NamespaceBuild },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* tx.query((tx) =>
            tx.execute(
              `CREATE SCHEMA IF NOT EXISTS "${namespaceBuild.viewsSchema}"`,
            ),
          );

          // Note: Drop views before creating new ones because Postgres does not support
          // altering the schema of a view with CREATE OR REPLACE VIEW.

          for (const table of tables) {
            yield* tx.query((tx) =>
              tx.execute(
                `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."${getTableName(table)}"`,
              ),
            );

            yield* tx.query((tx) =>
              tx.execute(
                `CREATE VIEW "${namespaceBuild.viewsSchema}"."${getTableName(table)}" AS SELECT * FROM "${namespaceBuild.schema}"."${getTableName(table)}"`,
              ),
            );
          }

          for (const view of views) {
            yield* tx.query((tx) =>
              tx.execute(
                `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."${getViewName(view)}"`,
              ),
            );

            yield* tx.query((tx) =>
              tx.execute(
                `CREATE VIEW "${namespaceBuild.viewsSchema}"."${getViewName(view)}" AS SELECT * FROM "${namespaceBuild.schema}"."${getViewName(view)}"`,
              ),
            );
          }

          yield* tx.query((tx) =>
            tx.execute(
              `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."${PONDER_META_TABLE_NAME}"`,
            ),
          );

          yield* tx.query((tx) =>
            tx.execute(
              `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."${PONDER_CHECKPOINT_TABLE_NAME}"`,
            ),
          );

          yield* tx.query((tx) =>
            tx.execute(
              `CREATE VIEW "${namespaceBuild.viewsSchema}"."${PONDER_META_TABLE_NAME}" AS SELECT * FROM "${namespaceBuild.schema}"."${PONDER_META_TABLE_NAME}"`,
            ),
          );

          yield* tx.query((tx) =>
            tx.execute(
              `CREATE VIEW "${namespaceBuild.viewsSchema}"."${PONDER_CHECKPOINT_TABLE_NAME}" AS SELECT * FROM "${namespaceBuild.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}"`,
            ),
          );

          const channel = getLiveQueryChannelName(namespaceBuild.viewsSchema!);

          yield* tx.query((tx) =>
            tx.execute(
              getLiveQueryNotifyProcedureSql({
                schema: namespaceBuild.viewsSchema!,
                channel,
              }),
            ),
          );

          const trigger = getViewsLiveQueryNotifyTriggerName(
            namespaceBuild.viewsSchema!,
          );
          const notifyProcedure = getLiveQueryNotifyProcedureName();

          yield* tx.query((tx) =>
            tx.execute(
              `
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespaceBuild.schema!}"."${PONDER_CHECKPOINT_TABLE_NAME}"
FOR EACH STATEMENT
EXECUTE PROCEDURE "${namespaceBuild.viewsSchema}".${notifyProcedure};`,
            ),
          );
        }),
      { label: "create_views", ...context },
    );
  });

export const revertOmnichain = (
  client: DbClient,
  {
    checkpoint,
    tables,
  }: {
    checkpoint: string;
    tables: Table[];
  },
  context?: QueryOptions,
): Effect.Effect<number[], Error> =>
  Effect.gen(function* () {
    if (tables.length === 0) return [];

    return yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          const counts: number[] = [];

          for (const table of tables) {
            const primaryKeyColumns = getPrimaryKeyColumns(table);
            const schema = getTableConfig(table).schema ?? "public";

            const result = yield* tx.query((tx) =>
              tx.execute(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getReorgTableName(table)}"
  WHERE checkpoint > '${checkpoint}' RETURNING * 
), reverted2 AS (
  SELECT ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}, MIN(operation_id) AS operation_id FROM reverted1
  GROUP BY ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}
), reverted3 AS (
  SELECT ${Object.values(getTableColumns(table))
    .map((column) => `reverted1."${getColumnCasing(column, "snake_case")}"`)
    .join(", ")}, reverted1.operation FROM reverted2
  INNER JOIN reverted1
  ON ${primaryKeyColumns.map(({ sql }) => `reverted2."${sql}" = reverted1."${sql}"`).join("AND ")}
  AND reverted2.operation_id = reverted1.operation_id
), ${getRevertSql({ table })};`),
            );

            // @ts-expect-error
            counts.push(result.rows[0]!.count);
          }

          return counts;
        }),
      { label: "revert", ...context },
    );
  });

/**
 * SQL that matches the reorg rows of each chain at or after its checkpoint in
 * `executedCheckpoints`.
 *
 * Note: The operations of the events of a chain are in checkpoint order, so
 * these are the rows of the events at or after each checkpoint.
 */
const getExecutedCheckpointsSql = (executedCheckpoints: string[]) =>
  executedCheckpoints
    .map(
      (checkpoint) => `
OR (SUBSTRING(checkpoint, 11, 16)::numeric = ${String(decodeCheckpoint(checkpoint).chainId)}
AND checkpoint >= '${checkpoint}')`,
    )
    .join("");

export const revertMultichain = (
  client: DbClient,
  {
    checkpoint,
    executedCheckpoints = [],
    tables,
  }: {
    checkpoint: string;
    /**
     * The checkpoint of the first executed event of each chain that is indexed
     * again. The rows of the chain at or after it are reverted.
     */
    executedCheckpoints?: string[];
    tables: Table[];
  },
  context?: QueryOptions,
): Effect.Effect<number[], Error> =>
  Effect.gen(function* () {
    if (tables.length === 0) return [];

    return yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          const counts: number[] = [];

          const minOperationId = yield* tx
            .query((tx) =>
              tx.execute(`
SELECT MIN(operation_id) AS operation_id FROM (
${tables
  .map(
    (table) => `
SELECT MIN(operation_id) AS operation_id FROM "${getTableConfig(table).schema ?? "public"}"."${getReorgTableName(table)}"
WHERE SUBSTRING(checkpoint, 11, 16)::numeric = ${String(decodeCheckpoint(checkpoint).chainId)}
AND checkpoint > '${checkpoint}'${getExecutedCheckpointsSql(executedCheckpoints)}`,
  )
  .join(" UNION ALL ")}) AS all_mins;`),
            )
            .pipe(
              Effect.map((result) => {
                return result.rows[0]?.operation_id as string | null;
              }),
            );

          for (const table of tables) {
            const primaryKeyColumns = getPrimaryKeyColumns(table);
            const schema = getTableConfig(table).schema ?? "public";

            const result = yield* tx.query((tx) =>
              tx.execute(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getReorgTableName(table)}"
  WHERE ${minOperationId!} IS NOT NULL AND operation_id >= ${minOperationId!}
  RETURNING * 
), reverted2 AS (
  SELECT ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}, MIN(operation_id) AS operation_id FROM reverted1
  GROUP BY ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}
), reverted3 AS (
  SELECT ${Object.values(getTableColumns(table))
    .map((column) => `reverted1."${getColumnCasing(column, "snake_case")}"`)
    .join(", ")}, reverted1.operation FROM reverted2
  INNER JOIN reverted1
  ON ${primaryKeyColumns.map(({ sql }) => `reverted2."${sql}" = reverted1."${sql}"`).join("AND ")}
  AND reverted2.operation_id = reverted1.operation_id
), ${getRevertSql({ table })};`),
            );

            // @ts-expect-error
            counts.push(result.rows[0]!.count);
          }

          return counts;
        }),
      { label: "revert", ...context },
    );
  });

export const revertIsolated = (
  client: DbClient,
  {
    checkpoint,
    tables,
  }: {
    checkpoint: string;
    tables: Table[];
  },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    if (tables.length === 0) return [];

    return yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          const counts: number[] = [];

          for (const table of tables) {
            const primaryKeyColumns = getPrimaryKeyColumns(table);
            const schema = getTableConfig(table).schema ?? "public";

            const result = yield* tx.query((tx) =>
              tx.execute(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getReorgTableName(table)}"
  WHERE checkpoint > '${checkpoint}' AND SUBSTRING(checkpoint, 11, 16)::numeric = ${String(decodeCheckpoint(checkpoint).chainId)} RETURNING * 
), reverted2 AS (
  SELECT ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}, MIN(operation_id) AS operation_id FROM reverted1
  GROUP BY ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}
), reverted3 AS (
  SELECT ${Object.values(getTableColumns(table))
    .map((column) => `reverted1."${getColumnCasing(column, "snake_case")}"`)
    .join(", ")}, reverted1.operation FROM reverted2
  INNER JOIN reverted1
  ON ${primaryKeyColumns.map(({ sql }) => `reverted2."${sql}" = reverted1."${sql}"`).join("AND ")}
  AND reverted2.operation_id = reverted1.operation_id
), ${getRevertSql({ table })};`),
            );

            // @ts-expect-error
            counts.push(result.rows[0]!.count);
          }

          return counts;
        }),
      { label: "revert", ...context },
    );
  });

export const finalizeOmnichain = (
  client: DbClient,
  {
    checkpoint,
    chainNames,
    tables,
    namespaceBuild,
  }: {
    checkpoint: string;
    /**
     * The chains whose finalized checkpoint moves to `checkpoint`.
     *
     * Note: The finalized checkpoint of a chain must not be after the finalized
     * block of the chain.
     */
    chainNames: string[];
    tables: Table[];
    namespaceBuild: NamespaceBuild;
  },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);

    // TODO(kyle) is this breaking an invariant?
    if (tables.length === 0) {
      yield* client.query(
        (db) =>
          db.update(PONDER_CHECKPOINT).set({ safeCheckpoint: checkpoint }),
        context,
      );
      yield* client.query(
        (db) =>
          db
            .update(PONDER_CHECKPOINT)
            .set({ finalizedCheckpoint: checkpoint })
            .where(inArray(PONDER_CHECKPOINT.chainName, chainNames)),
        context,
      );
      return;
    }

    return yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* tx.query((tx) =>
            tx.update(PONDER_CHECKPOINT).set({ safeCheckpoint: checkpoint }),
          );
          yield* tx.query((tx) =>
            tx
              .update(PONDER_CHECKPOINT)
              .set({ finalizedCheckpoint: checkpoint })
              .where(inArray(PONDER_CHECKPOINT.chainName, chainNames)),
          );

          for (const table of tables) {
            yield* tx.query((tx) =>
              tx
                .delete(getReorgTable(table))
                .where(lte(getReorgTable(table).checkpoint, checkpoint)),
            );
          }
        }),
      { label: "finalize", ...context },
    );
  });

export const finalizeMultichain = (
  client: DbClient,
  {
    checkpoint,
    executedCheckpoints = [],
    tables,
    namespaceBuild,
  }: {
    checkpoint: string;
    /**
     * The checkpoint of the first executed event of each chain that can be
     * indexed again after a reorg. The rows of the chain at or after it are
     * kept.
     */
    executedCheckpoints?: string[];
    tables: Table[];
    namespaceBuild: NamespaceBuild;
  },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);
    const chainId = Number(decodeCheckpoint(checkpoint).chainId);

    if (tables.length === 0) {
      yield* client.query(
        (db) =>
          db
            .update(PONDER_CHECKPOINT)
            .set({
              finalizedCheckpoint: checkpoint,
              safeCheckpoint: checkpoint,
            })
            .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
        context,
      );
      return;
    }

    // NOTE: It is invariant that PONDER_CHECKPOINT has a value for each chain.

    return yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* tx.query((tx) =>
            tx
              .update(PONDER_CHECKPOINT)
              .set({ finalizedCheckpoint: checkpoint })
              .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
          );

          const minOperationId = yield* tx
            .query((tx) =>
              tx.execute(`
SELECT MIN(operation_id) AS operation_id FROM (
${tables
  .map(
    (table) => `
SELECT MIN(operation_id) AS operation_id FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
WHERE checkpoint > (
  SELECT finalized_checkpoint 
  FROM "${getTableConfig(PONDER_CHECKPOINT).schema ?? "public"}"."${getTableName(PONDER_CHECKPOINT)}" 
  WHERE chain_id = SUBSTRING(checkpoint, 11, 16)::numeric
)${getExecutedCheckpointsSql(executedCheckpoints)}`,
  )
  .join(" UNION ALL ")}) AS all_mins;`),
            )
            .pipe(
              Effect.map((result) => {
                return result.rows[0]?.operation_id as string | null;
              }),
            );

          const result = yield* tx.query((tx) =>
            tx.execute(`
    WITH ${tables
      .map(
        (table, index) => `
    deleted_${index} AS (
      DELETE FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
      WHERE ${minOperationId} IS NULL OR operation_id < ${minOperationId}
      RETURNING *
    )`,
      )
      .join(",\n")},
    all_deleted AS (
      ${tables
        .map((_, index) => `SELECT checkpoint FROM deleted_${index}`)
        .join(" UNION ALL ")}
    )
    SELECT MAX(checkpoint) as safe_checkpoint, SUBSTRING(checkpoint, 11, 16)::numeric as chain_id
    FROM all_deleted
    GROUP BY SUBSTRING(checkpoint, 11, 16)::numeric;`),
          );

          for (const { chain_id, safe_checkpoint } of result.rows) {
            yield* tx.query((tx) =>
              tx
                .update(PONDER_CHECKPOINT)
                .set({ safeCheckpoint: safe_checkpoint as string })
                .where(eq(PONDER_CHECKPOINT.chainId, chain_id as number)),
            );
          }
        }),
      { label: "finalize", ...context },
    );
  });

export const finalizeIsolated = (
  client: DbClient,
  {
    checkpoint,
    tables,
    namespaceBuild,
  }: {
    checkpoint: string;
    tables: Table[];
    namespaceBuild: NamespaceBuild;
  },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);
    const chainId = Number(decodeCheckpoint(checkpoint).chainId);

    if (tables.length === 0) {
      yield* client.query(
        (db) =>
          db
            .update(PONDER_CHECKPOINT)
            .set({
              finalizedCheckpoint: checkpoint,
              safeCheckpoint: checkpoint,
            })
            .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
        context,
      );
      return;
    }
    return yield* client.transaction(
      (tx) =>
        Effect.gen(function* () {
          yield* tx.query((tx) =>
            tx
              .update(PONDER_CHECKPOINT)
              .set({
                finalizedCheckpoint: checkpoint,
                safeCheckpoint: checkpoint,
              })
              .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
          );

          for (const table of tables) {
            yield* tx.query((tx) =>
              tx
                .delete(getReorgTable(table))
                .where(
                  and(
                    lte(getReorgTable(table).checkpoint, checkpoint),
                    eq(sql`chain_id`, chainId),
                  ),
                ),
            );
          }
        }),
      { label: "finalize" },
    );
  });

export const commitBlock = (
  client: DbClient,
  {
    checkpoint,
    table,
    preBuild,
  }: { checkpoint: string; table: Table; preBuild: Pick<PreBuild, "ordering"> },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    const reorgTable = getReorgTable(table);
    let whereClause: SQL;
    if (preBuild.ordering === "experimental_isolated") {
      // Note: Query must include `chain_id` because it's possible for multiple chains to be indexing in parallel.
      const chainId = Number(decodeCheckpoint(checkpoint).chainId);
      whereClause = and(
        eq(reorgTable.checkpoint, MAX_CHECKPOINT_STRING),
        eq(sql`chain_id`, chainId),
      )!;
    } else {
      whereClause = eq(reorgTable.checkpoint, MAX_CHECKPOINT_STRING);
    }

    yield* client.query(
      (db) => db.update(reorgTable).set({ checkpoint }).where(whereClause),
      { label: "commit_block", ...context },
    );
  });

export const crashRecovery = (
  client: DbClient,
  { table }: { table: Table },
  context?: QueryOptions,
) =>
  Effect.gen(function* () {
    const primaryKeyColumns = getPrimaryKeyColumns(table);
    const schema = getTableConfig(table).schema ?? "public";

    yield* client.query(
      (db) =>
        db.execute(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
  RETURNING *
), reverted2 AS (
  SELECT ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}, MIN(operation_id) AS operation_id FROM reverted1
  GROUP BY ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}
), reverted3 AS (
  SELECT ${Object.values(getTableColumns(table))
    .map((column) => `reverted1."${getColumnCasing(column, "snake_case")}"`)
    .join(", ")}, reverted1.operation FROM reverted2
  INNER JOIN reverted1
  ON ${primaryKeyColumns.map(({ sql }) => `reverted2."${sql}" = reverted1."${sql}"`).join("AND ")}
  AND reverted2.operation_id = reverted1.operation_id
), ${getRevertSql({ table })}`),
      context,
    );
  });

const getRevertSql = ({ table }: { table: Table }) => {
  const primaryKeyColumns = getPrimaryKeyColumns(table);
  const schema = getTableConfig(table).schema ?? "public";

  return `
inserted AS (
  DELETE FROM "${schema}"."${getTableName(table)}" as t
  WHERE EXISTS (
    SELECT * FROM reverted3
    WHERE ${primaryKeyColumns.map(({ sql }) => `t."${sql}" = reverted3."${sql}"`).join("AND ")}
    AND OPERATION = 0
  )
  RETURNING *
), updated_or_deleted AS (
  INSERT INTO  "${schema}"."${getTableName(table)}"
  SELECT ${Object.values(getTableColumns(table))
    .map((column) => `"${getColumnCasing(column, "snake_case")}"`)
    .join(", ")} FROM reverted3
  WHERE operation = 1 OR operation = 2
  ON CONFLICT (${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")})
  DO UPDATE SET
    ${Object.values(getTableColumns(table))
      .map(
        (column) =>
          `"${getColumnCasing(column, "snake_case")}" = EXCLUDED."${getColumnCasing(column, "snake_case")}"`,
      )
      .join(", ")}
  RETURNING *
) SELECT COUNT(*) FROM reverted1 as count;`;
};
