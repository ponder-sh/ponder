import {
  getPartitionName,
  getPrimaryKeyColumns,
  getReorgProcedureName,
  getReorgTableName,
  getReorgTriggerName,
} from "@/drizzle/index.js";
import { getColumnCasing, getReorgTable } from "@/drizzle/kit/index.js";
import {
  getLiveQueryChannelName,
  getLiveQueryNotifyProcedureName,
  getLiveQueryNotifyTriggerName,
  getLiveQueryProcedureName,
  getLiveQueryTriggerName,
  getViewsLiveQueryNotifyTriggerName,
} from "@/drizzle/onchain.js";
import type { Logger } from "@/internal/logger.js";
import type {
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
import { MAX_CHECKPOINT_STRING, decodeCheckpoint } from "@/utils/checkpoint.js";
import {
  type SQL,
  type Table,
  type View,
  and,
  eq,
  getTableColumns,
  getTableName,
  getViewName,
  lte,
  sql,
} from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getPonderCheckpointTable } from "./index.js";
import type { QB } from "./queryBuilder.js";

export const createIndexes = async (
  qb: QB,
  { statements }: { statements: SchemaBuild["statements"] },
  context?: { logger?: Logger },
) => {
  for (const statement of statements.indexes.sql) {
    await qb.transaction(
      { label: "create_indexes" },
      async (tx) => {
        // 60 minutes
        await tx.wrap((tx) => tx.execute("SET statement_timeout = 3600000;"));
        await tx.wrap((tx) => tx.execute(statement));
      },
      undefined,
      context,
    );
  }
};

export const createTriggers = async (
  qb: QB,
  { tables, chainId }: { tables: Table[]; chainId?: number },
  context?: { logger?: Logger },
) => {
  await qb.transaction(
    async (tx) => {
      await Promise.all(
        tables.map(async (table) => {
          const schema = getTableConfig(table).schema ?? "public";
          const columns = getTableColumns(table);

          const columnNames = Object.values(columns).map(
            (column) => `"${getColumnCasing(column, "snake_case")}"`,
          );

          await tx.wrap({ label: "create_trigger" }, (tx) =>
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
          );

          await tx.wrap({ label: "create_trigger" }, (tx) =>
            tx.execute(
              `
  CREATE OR REPLACE TRIGGER "${getReorgTriggerName()}"
  AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"
  FOR EACH ROW EXECUTE PROCEDURE "${schema}".${getReorgProcedureName(table)};
  `,
            ),
          );
        }),
      );
    },
    undefined,
    context,
  );
};

export const dropTriggers = async (
  qb: QB,
  { tables, chainId }: { tables: Table[]; chainId?: number },
  context?: { logger?: Logger },
) => {
  await qb.transaction(
    async (tx) => {
      await Promise.all(
        tables.map(async (table) => {
          const schema = getTableConfig(table).schema ?? "public";

          await tx.wrap({ label: "drop_trigger" }, (tx) =>
            tx.execute(
              `DROP TRIGGER IF EXISTS "${getReorgTriggerName()}" ON "${schema}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"`,
            ),
          );
        }),
      );
    },
    undefined,
    context,
  );
};

export const createLiveQueryTriggers = async (
  qb: QB,
  {
    namespaceBuild,
    tables,
    chainId,
  }: { namespaceBuild: NamespaceBuild; tables: Table[]; chainId?: number },
  context?: { logger?: Logger },
) => {
  await qb.transaction(
    async (tx) => {
      const notifyProcedure = getLiveQueryNotifyProcedureName();
      const notifyTrigger = getLiveQueryNotifyTriggerName();

      await tx.wrap((tx) =>
        tx.execute(
          `
CREATE OR REPLACE TRIGGER "${notifyTrigger}"
AFTER INSERT OR UPDATE OR DELETE ON "${namespaceBuild.schema}"._ponder_checkpoint
FOR EACH STATEMENT EXECUTE PROCEDURE "${namespaceBuild.schema}".${notifyProcedure};`,
        ),
      );

      const trigger = getLiveQueryTriggerName();
      const procedure = getLiveQueryProcedureName();

      for (const table of tables) {
        const schema = getTableConfig(table).schema ?? "public";

        // Note: Because the realtime indexing store writes to the parent table, we create the trigger on
        // the parent table instead of the partition table.
        await tx.wrap((tx) =>
          tx.execute(
            `
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"
FOR EACH ROW EXECUTE PROCEDURE "${schema}".${procedure};`,
          ),
        );
      }
    },
    undefined,
    context,
  );
};

export const dropLiveQueryTriggers = async (
  qb: QB,
  {
    namespaceBuild,
    tables,
    chainId,
  }: { namespaceBuild: NamespaceBuild; tables: Table[]; chainId?: number },
  context?: { logger?: Logger },
) => {
  await qb.transaction(
    async (tx) => {
      const notifyTrigger = getLiveQueryNotifyTriggerName();
      await tx.wrap((tx) =>
        tx.execute(
          `DROP TRIGGER IF EXISTS "${notifyTrigger}" ON "${namespaceBuild.schema}"._ponder_checkpoint;`,
        ),
      );

      const trigger = getLiveQueryTriggerName();
      for (const table of tables) {
        const schema = getTableConfig(table).schema ?? "public";

        await tx.wrap((tx) =>
          tx.execute(
            `DROP TRIGGER IF EXISTS "${trigger}" ON "${schema}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}";`,
          ),
        );
      }
    },
    undefined,
    context,
  );
};

export const createLiveQueryProcedures = async (
  qb: QB,
  { namespaceBuild }: { namespaceBuild: NamespaceBuild },
  context?: { logger?: Logger },
) => {
  await qb.transaction(
    async (tx) => {
      const schema = namespaceBuild.schema;
      const procedure = getLiveQueryProcedureName();

      await tx.wrap(
        (tx) =>
          tx.execute(
            `
CREATE OR REPLACE FUNCTION "${schema}".${procedure}
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO live_query_tables (table_name)
  VALUES (TG_TABLE_NAME)
  ON CONFLICT (table_name) DO NOTHING;
  RETURN NULL;
END;
$$;`,
          ),
        context,
      );

      const notifyProcedure = getLiveQueryNotifyProcedureName();
      const channel = getLiveQueryChannelName(namespaceBuild.schema);

      await tx.wrap(
        (tx) =>
          tx.execute(`
CREATE OR REPLACE FUNCTION "${schema}".${notifyProcedure}
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
  DECLARE
    table_names json;
    table_exists boolean := false;
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = 'live_query_tables'
      AND table_type = 'LOCAL TEMPORARY'
    ) INTO table_exists;

    IF table_exists THEN
      SELECT json_agg(table_name) INTO table_names
      FROM live_query_tables;

      table_names := COALESCE(table_names, '[]'::json);
      PERFORM pg_notify('${channel}', table_names::text);
    END IF;

    RETURN NULL;
  END;
$$;`),
        context,
      );
    },
    undefined,
    context,
  );
};

export const createViews = async (
  qb: QB,
  {
    tables,
    views,
    namespaceBuild,
  }: { tables: Table[]; views: View[]; namespaceBuild: NamespaceBuild },
  context?: { logger?: Logger },
) => {
  await qb.transaction(
    { label: "create_views" },
    async (tx) => {
      await tx.wrap((tx) =>
        tx.execute(
          `CREATE SCHEMA IF NOT EXISTS "${namespaceBuild.viewsSchema}"`,
        ),
      );

      // Note: Drop views before creating new ones because Postgres does not support
      // altering the schema of a view with CREATE OR REPLACE VIEW.

      for (const table of tables) {
        await tx.wrap((tx) =>
          tx.execute(
            `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."${getTableName(table)}"`,
          ),
        );

        await tx.wrap((tx) =>
          tx.execute(
            `CREATE VIEW "${namespaceBuild.viewsSchema}"."${getTableName(table)}" AS SELECT * FROM "${namespaceBuild.schema}"."${getTableName(table)}"`,
          ),
        );
      }

      for (const view of views) {
        await tx.wrap((tx) =>
          tx.execute(
            `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."${getViewName(view)}"`,
          ),
        );

        await tx.wrap((tx) =>
          tx.execute(
            `CREATE VIEW "${namespaceBuild.viewsSchema}"."${getViewName(view)}" AS SELECT * FROM "${namespaceBuild.schema}"."${getViewName(view)}"`,
          ),
        );
      }

      await tx.wrap((tx) =>
        tx.execute(
          `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."_ponder_meta"`,
        ),
      );

      await tx.wrap((tx) =>
        tx.execute(
          `DROP VIEW IF EXISTS "${namespaceBuild.viewsSchema}"."_ponder_checkpoint"`,
        ),
      );

      await tx.wrap((tx) =>
        tx.execute(
          `CREATE VIEW "${namespaceBuild.viewsSchema}"."_ponder_meta" AS SELECT * FROM "${namespaceBuild.schema}"."_ponder_meta"`,
        ),
      );

      await tx.wrap((tx) =>
        tx.execute(
          `CREATE VIEW "${namespaceBuild.viewsSchema}"."_ponder_checkpoint" AS SELECT * FROM "${namespaceBuild.schema}"."_ponder_checkpoint"`,
        ),
      );

      const notifyProcedure = getLiveQueryNotifyProcedureName();
      const channel = getLiveQueryChannelName(namespaceBuild.viewsSchema!);

      await tx.wrap((tx) =>
        tx.execute(`
CREATE OR REPLACE FUNCTION "${namespaceBuild.viewsSchema}".${notifyProcedure}
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
  DECLARE
    table_names json;
    table_exists boolean := false;
  BEGIN
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = 'live_query_tables'
      AND table_type = 'LOCAL TEMPORARY'
    ) INTO table_exists;

    IF table_exists THEN
      SELECT json_agg(table_name) INTO table_names
      FROM live_query_tables;

      table_names := COALESCE(table_names, '[]'::json);
      PERFORM pg_notify('${channel}', table_names::text);
    END IF;

    RETURN NULL;
  END;
$$;`),
      );

      const trigger = getViewsLiveQueryNotifyTriggerName(
        namespaceBuild.viewsSchema,
      );

      await tx.wrap((tx) =>
        tx.execute(
          `
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespaceBuild.schema!}"._ponder_checkpoint
FOR EACH STATEMENT
EXECUTE PROCEDURE "${namespaceBuild.viewsSchema}".${notifyProcedure};`,
        ),
      );
    },
    undefined,
    context,
  );
};

export const revertOmnichain = async (
  qb: QB,
  {
    checkpoint,
    tables,
  }: {
    checkpoint: string;
    tables: Table[];
  },
  context?: { logger?: Logger },
): Promise<number[]> => {
  if (tables.length === 0) return [];

  return qb.transaction(
    { label: "revert" },
    async (tx) => {
      const counts: number[] = [];

      for (const table of tables) {
        const primaryKeyColumns = getPrimaryKeyColumns(table);
        const schema = getTableConfig(table).schema ?? "public";

        const result = await tx.wrap((tx) =>
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

        // @ts-ignore
        counts.push(result.rows[0]!.count);
      }

      return counts;
    },
    undefined,
    context,
  );
};

export const revertMultichain = async (
  qb: QB,
  {
    checkpoint,
    tables,
  }: {
    checkpoint: string;
    tables: Table[];
  },
  context?: { logger?: Logger },
): Promise<number[]> => {
  if (tables.length === 0) return [];

  return qb.transaction(
    { label: "revert" },
    async (tx) => {
      const counts: number[] = [];

      const minOperationId = await tx
        .wrap((tx) =>
          tx.execute(`
SELECT MIN(operation_id) AS operation_id FROM (
${tables
  .map(
    (table) => `
SELECT MIN(operation_id) AS operation_id FROM "${getTableConfig(table).schema ?? "public"}"."${getReorgTableName(table)}"
WHERE SUBSTRING(checkpoint, 11, 16)::numeric = ${String(decodeCheckpoint(checkpoint).chainId)}
AND checkpoint > '${checkpoint}'`,
  )
  .join(" UNION ALL ")}) AS all_mins;`),
        )
        .then((result) => {
          // @ts-ignore
          return result.rows[0]?.operation_id as string | null;
        });

      for (const table of tables) {
        const primaryKeyColumns = getPrimaryKeyColumns(table);
        const schema = getTableConfig(table).schema ?? "public";

        const result = await tx.wrap((tx) =>
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

        // @ts-ignore
        counts.push(result.rows[0]!.count);
      }

      return counts;
    },
    undefined,
    context,
  );
};

export const revertIsolated = async (
  qb: QB,
  {
    checkpoint,
    tables,
  }: {
    checkpoint: string;
    tables: Table[];
  },
  context?: { logger?: Logger },
) => {
  if (tables.length === 0) return [];

  return qb.transaction(
    { label: "revert" },
    async (tx) => {
      const counts: number[] = [];

      for (const table of tables) {
        const primaryKeyColumns = getPrimaryKeyColumns(table);
        const schema = getTableConfig(table).schema ?? "public";

        const result = await tx.wrap((tx) =>
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

        // @ts-ignore
        counts.push(result.rows[0]!.count);
      }

      return counts;
    },
    undefined,
    context,
  );
};

export const finalizeOmnichain = async (
  qb: QB,
  {
    checkpoint,
    tables,
    namespaceBuild,
  }: {
    checkpoint: string;
    tables: Table[];
    namespaceBuild: NamespaceBuild;
  },
  context?: { logger?: Logger },
) => {
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);

  // TODO(kyle) is this breaking an invariant?
  if (tables.length === 0) {
    await qb.wrap(
      (db) =>
        db
          .update(PONDER_CHECKPOINT)
          .set({ finalizedCheckpoint: checkpoint, safeCheckpoint: checkpoint }),
      context,
    );
    return;
  }

  return qb.transaction(
    { label: "finalize" },
    async (tx) => {
      await tx.wrap((tx) =>
        tx.update(PONDER_CHECKPOINT).set({
          finalizedCheckpoint: checkpoint,
          safeCheckpoint: checkpoint,
        }),
      );

      for (const table of tables) {
        await tx.wrap((tx) =>
          tx
            .delete(getReorgTable(table))
            .where(lte(getReorgTable(table).checkpoint, checkpoint)),
        );
      }
    },
    undefined,
    context,
  );
};

export const finalizeMultichain = async (
  qb: QB,
  {
    checkpoint,
    tables,
    namespaceBuild,
  }: {
    checkpoint: string;
    tables: Table[];
    namespaceBuild: NamespaceBuild;
  },
  context?: { logger?: Logger },
) => {
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);

  // TODO(kyle) is this breaking an invariant?
  if (tables.length === 0) {
    await qb.wrap(
      (db) =>
        db
          .update(PONDER_CHECKPOINT)
          .set({ finalizedCheckpoint: checkpoint, safeCheckpoint: checkpoint }),
      context,
    );
    return;
  }

  // NOTE: It is invariant that PONDER_CHECKPOINT has a value for each chain.

  return qb.transaction(
    { label: "finalize" },
    async (tx) => {
      await tx.wrap((tx) =>
        tx
          .update(PONDER_CHECKPOINT)
          .set({ finalizedCheckpoint: checkpoint })
          .where(
            eq(
              PONDER_CHECKPOINT.chainId,
              Number(decodeCheckpoint(checkpoint).chainId),
            ),
          ),
      );

      const minOperationId = await tx
        .wrap((tx) =>
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
)`,
  )
  .join(" UNION ALL ")}) AS all_mins;`),
        )
        .then((result) => {
          // @ts-ignore
          return result.rows[0]?.operation_id as string | null;
        });

      const result = await tx.wrap((tx) =>
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
        await tx.wrap((tx) =>
          tx
            .update(PONDER_CHECKPOINT)
            .set({ safeCheckpoint: safe_checkpoint as string })
            .where(eq(PONDER_CHECKPOINT.chainId, chain_id as number)),
        );
      }
    },
    undefined,
    context,
  );
};

export const finalizeIsolated = async (
  qb: QB,
  {
    checkpoint,
    tables,
    namespaceBuild,
  }: {
    checkpoint: string;
    tables: Table[];
    namespaceBuild: NamespaceBuild;
  },
  context?: { logger?: Logger },
) => {
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);
  const chainId = Number(decodeCheckpoint(checkpoint).chainId);

  if (tables.length === 0) {
    await qb.wrap(
      (db) =>
        db
          .update(PONDER_CHECKPOINT)
          .set({ finalizedCheckpoint: checkpoint, safeCheckpoint: checkpoint })
          .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
      context,
    );
    return;
  }
  return qb.transaction({ label: "finalize" }, async (tx) => {
    await tx.wrap((tx) =>
      tx
        .update(PONDER_CHECKPOINT)
        .set({ finalizedCheckpoint: checkpoint, safeCheckpoint: checkpoint })
        .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
    );

    for (const table of tables) {
      await tx.wrap((tx) =>
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
  });
};

export const commitBlock = async (
  qb: QB,
  {
    checkpoint,
    table,
    preBuild,
  }: { checkpoint: string; table: Table; preBuild: Pick<PreBuild, "ordering"> },
  context?: { logger?: Logger },
) => {
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

  await qb.wrap(
    { label: "commit_block" },
    (db) => db.update(reorgTable).set({ checkpoint }).where(whereClause),
    context,
  );
};

export const crashRecovery = async (
  qb: QB,
  { table }: { table: Table },
  context?: { logger?: Logger },
) => {
  const primaryKeyColumns = getPrimaryKeyColumns(table);
  const schema = getTableConfig(table).schema ?? "public";

  await qb.wrap(
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
};

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
