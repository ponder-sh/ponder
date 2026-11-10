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
import { getPrimaryKeyColumns } from "../drizzle/index.js";
import { getColumnCasing, getReorgTable } from "../drizzle/kit/index.js";
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
} from "../drizzle/onchain.js";
import type {
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "../internal/types.js";
import {
  decodeCheckpoint,
  MAX_CHECKPOINT_STRING,
} from "../utils/checkpoint.js";
import { builder, rawSql, type Statement } from "./db.js";
import {
  getPonderCheckpointTable,
  PONDER_CHECKPOINT_TABLE_NAME,
  PONDER_META_TABLE_NAME,
} from "./index.js";

const getSchema = (table: Table) => getTableConfig(table).schema ?? "public";

const getTarget = (table: Table, chainId?: number) =>
  `"${getSchema(table)}"."${chainId === undefined ? getTableName(table) : getPartitionName(table, chainId)}"`;

/**
 * The statements that create each index, each with a statement timeout of
 * 60 minutes. Each list runs in its own transaction.
 */
export const createIndexes = ({
  statements,
}: {
  statements: SchemaBuild["statements"];
}): Statement[][] =>
  statements.indexes.sql.map((statement) => [
    rawSql("SET LOCAL statement_timeout = 3600000"),
    rawSql(statement),
  ]);

export const createTriggers = ({
  tables,
  chainId,
}: {
  tables: Table[];
  chainId?: number;
}): Statement[] =>
  tables.flatMap((table) => {
    const schema = getSchema(table);
    const columnNames = Object.values(getTableColumns(table)).map(
      (column) => `"${getColumnCasing(column, "snake_case")}"`,
    );
    const reorgTable = `"${schema}"."${getReorgTableName(table)}"`;
    const insert = (row: "NEW" | "OLD", operation: 0 | 1 | 2) => `
  INSERT INTO ${reorgTable} (${columnNames.join(",")}, operation, checkpoint)
  VALUES (${columnNames.map((name) => `${row}.${name}`).join(",")}, ${operation}, '${MAX_CHECKPOINT_STRING}');`;

    return [
      rawSql(`
  CREATE OR REPLACE FUNCTION "${schema}".${getReorgProcedureName(table)}
  RETURNS TRIGGER AS $$
  BEGIN
  IF TG_OP = 'INSERT' THEN${insert("NEW", 0)}
  ELSIF TG_OP = 'UPDATE' THEN${insert("OLD", 1)}
  ELSIF TG_OP = 'DELETE' THEN${insert("OLD", 2)}
  END IF;
  RETURN NULL;
  END;
  $$ LANGUAGE plpgsql`),
      rawSql(`
  CREATE OR REPLACE TRIGGER "${getReorgTriggerName()}"
  AFTER INSERT OR UPDATE OR DELETE ON ${getTarget(table, chainId)}
  FOR EACH ROW EXECUTE PROCEDURE "${schema}".${getReorgProcedureName(table)};
  `),
    ];
  });

export const dropTriggers = ({
  tables,
  chainId,
}: {
  tables: Table[];
  chainId?: number;
}): Statement[] =>
  tables.map((table) =>
    rawSql(
      `DROP TRIGGER IF EXISTS "${getReorgTriggerName()}" ON ${getTarget(table, chainId)}`,
    ),
  );

export const createLiveQueryTriggers = ({
  namespaceBuild,
  tables,
  chainId,
}: {
  namespaceBuild: NamespaceBuild;
  tables: Table[];
  chainId?: number;
}): Statement[] => [
  rawSql(`
CREATE OR REPLACE TRIGGER "${getLiveQueryNotifyTriggerName()}"
AFTER INSERT OR UPDATE OR DELETE ON "${namespaceBuild.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}"
FOR EACH STATEMENT EXECUTE PROCEDURE "${namespaceBuild.schema}".${getLiveQueryNotifyProcedureName()};`),
  // Note: Because the realtime indexing store writes to the parent table, we create the trigger on
  // the parent table instead of the partition table.
  ...tables.map((table) =>
    rawSql(`
CREATE OR REPLACE TRIGGER "${getLiveQueryTriggerName()}"
AFTER INSERT OR UPDATE OR DELETE ON ${getTarget(table, chainId)}
FOR EACH ROW EXECUTE PROCEDURE "${getSchema(table)}".${getLiveQueryProcedureName()};`),
  ),
];

export const dropLiveQueryTriggers = ({
  namespaceBuild,
  tables,
  chainId,
}: {
  namespaceBuild: NamespaceBuild;
  tables: Table[];
  chainId?: number;
}): Statement[] => [
  rawSql(
    `DROP TRIGGER IF EXISTS "${getLiveQueryNotifyTriggerName()}" ON "${namespaceBuild.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}";`,
  ),
  ...tables.map((table) =>
    rawSql(
      `DROP TRIGGER IF EXISTS "${getLiveQueryTriggerName()}" ON ${getTarget(table, chainId)};`,
    ),
  ),
];

export const createLiveQueryProcedures = ({
  namespaceBuild,
}: {
  namespaceBuild: NamespaceBuild;
}): Statement[] => [
  rawSql(`
CREATE OR REPLACE FUNCTION "${namespaceBuild.schema}".${getLiveQueryProcedureName()}
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ${getLiveQueryTempTableName()} (table_name)
  VALUES (TG_TABLE_NAME)
  ON CONFLICT (table_name) DO NOTHING;
  RETURN NULL;
END;
$$;`),
  rawSql(
    getLiveQueryNotifyProcedureSql({
      schema: namespaceBuild.schema,
      channel: getLiveQueryChannelName(namespaceBuild.schema),
    }),
  ),
];

/**
 * The statements that create a view in the views schema of each table, view,
 * and internal table.
 *
 * @dev Views are dropped before they are created, because Postgres does not
 * support altering the columns of a view with `CREATE OR REPLACE VIEW`.
 */
export const createViews = ({
  tables,
  views,
  namespaceBuild,
}: {
  tables: Table[];
  views: View[];
  namespaceBuild: NamespaceBuild;
}): Statement[] => {
  const viewsSchema = namespaceBuild.viewsSchema!;
  const names = [
    ...tables.map(getTableName),
    ...views.map(getViewName),
    PONDER_META_TABLE_NAME,
    PONDER_CHECKPOINT_TABLE_NAME,
  ];

  return [
    rawSql(`CREATE SCHEMA IF NOT EXISTS "${viewsSchema}"`),
    ...names.flatMap((name) => [
      rawSql(`DROP VIEW IF EXISTS "${viewsSchema}"."${name}"`),
      rawSql(
        `CREATE VIEW "${viewsSchema}"."${name}" AS SELECT * FROM "${namespaceBuild.schema}"."${name}"`,
      ),
    ]),
    rawSql(
      getLiveQueryNotifyProcedureSql({
        schema: viewsSchema,
        channel: getLiveQueryChannelName(viewsSchema),
      }),
    ),
    rawSql(`
CREATE OR REPLACE TRIGGER "${getViewsLiveQueryNotifyTriggerName(viewsSchema)}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespaceBuild.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}"
FOR EACH STATEMENT
EXECUTE PROCEDURE "${viewsSchema}".${getLiveQueryNotifyProcedureName()};`),
  ];
};

/** The reverted row count of a revert statement. */
export const getRevertCount = (rows: unknown[]) =>
  Number((rows[0] as { count: string | number }).count);

/**
 * A statement that reverts the operations of the reorg table of `table` that
 * match `where`, and returns their count.
 */
const revert = (table: Table, where: string) => {
  const primaryKeyColumns = getPrimaryKeyColumns(table);
  const schema = getSchema(table);
  const columns = Object.values(getTableColumns(table)).map(
    (column) => `"${getColumnCasing(column, "snake_case")}"`,
  );
  const primaryKeys = primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ");

  return rawSql(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getReorgTableName(table)}"
  ${where} RETURNING *
), reverted2 AS (
  SELECT ${primaryKeys}, MIN(operation_id) AS operation_id FROM reverted1
  GROUP BY ${primaryKeys}
), reverted3 AS (
  SELECT ${columns.map((column) => `reverted1.${column}`).join(", ")}, reverted1.operation FROM reverted2
  INNER JOIN reverted1
  ON ${primaryKeyColumns.map(({ sql }) => `reverted2."${sql}" = reverted1."${sql}"`).join(" AND ")}
  AND reverted2.operation_id = reverted1.operation_id
), inserted AS (
  DELETE FROM "${schema}"."${getTableName(table)}" as t
  WHERE EXISTS (
    SELECT * FROM reverted3
    WHERE ${primaryKeyColumns.map(({ sql }) => `t."${sql}" = reverted3."${sql}"`).join(" AND ")}
    AND OPERATION = 0
  )
  RETURNING *
), updated_or_deleted AS (
  INSERT INTO "${schema}"."${getTableName(table)}"
  SELECT ${columns.join(", ")} FROM reverted3
  WHERE operation = 1 OR operation = 2
  ON CONFLICT (${primaryKeys})
  DO UPDATE SET
    ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")}
  RETURNING *
) SELECT COUNT(*) AS count FROM reverted1;`);
};

const chainIdSql = "SUBSTRING(checkpoint, 11, 16)::numeric";

/** A statement for each table, that reverts the operations after `checkpoint`. */
export const revertOmnichain = ({
  checkpoint,
  tables,
}: {
  checkpoint: string;
  tables: Table[];
}): Statement[] =>
  tables.map((table) => revert(table, `WHERE checkpoint > '${checkpoint}'`));

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
OR (${chainIdSql} = ${String(decodeCheckpoint(checkpoint).chainId)}
AND checkpoint >= '${checkpoint}')`,
    )
    .join("");

const MIN_OPERATION_ID = "ponder.min_operation_id";

/**
 * The statements that revert the operations of every table from the first
 * operation after `checkpoint` on its chain.
 *
 * @dev The first operation is found before any table is reverted, and kept
 * in a setting of the transaction.
 */
export const revertMultichain = ({
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
}): Statement[] => {
  if (tables.length === 0) return [];

  const minOperationId = tables
    .map(
      (table) => `
SELECT MIN(operation_id) AS operation_id FROM "${getSchema(table)}"."${getReorgTableName(table)}"
WHERE ${chainIdSql} = ${String(decodeCheckpoint(checkpoint).chainId)}
AND checkpoint > '${checkpoint}'${getExecutedCheckpointsSql(executedCheckpoints)}`,
    )
    .join(" UNION ALL ");

  return [
    rawSql(
      `SELECT set_config('${MIN_OPERATION_ID}', COALESCE((SELECT MIN(operation_id) FROM (${minOperationId}) AS all_mins)::text, ''), true)`,
    ),
    ...tables.map((table) =>
      revert(
        table,
        `WHERE operation_id >= NULLIF(current_setting('${MIN_OPERATION_ID}'), '')::integer`,
      ),
    ),
  ];
};

/** A statement for each table, that reverts the operations of the chain after `checkpoint`. */
export const revertIsolated = ({
  checkpoint,
  tables,
}: {
  checkpoint: string;
  tables: Table[];
}): Statement[] =>
  tables.map((table) =>
    revert(
      table,
      `WHERE checkpoint > '${checkpoint}' AND ${chainIdSql} = ${String(decodeCheckpoint(checkpoint).chainId)}`,
    ),
  );

export const finalizeOmnichain = ({
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
}): Statement[] => {
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);

  return [
    builder.update(PONDER_CHECKPOINT).set({ safeCheckpoint: checkpoint }),
    builder
      .update(PONDER_CHECKPOINT)
      .set({ finalizedCheckpoint: checkpoint })
      .where(inArray(PONDER_CHECKPOINT.chainName, chainNames)),
    ...tables.map((table) =>
      builder
        .delete(getReorgTable(table))
        .where(lte(getReorgTable(table).checkpoint, checkpoint)),
    ),
  ];
};

export const finalizeMultichain = ({
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
}): Statement[] => {
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);
  const chainId = Number(decodeCheckpoint(checkpoint).chainId);

  if (tables.length === 0) {
    return [
      builder
        .update(PONDER_CHECKPOINT)
        .set({ finalizedCheckpoint: checkpoint, safeCheckpoint: checkpoint })
        .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
    ];
  }

  // NOTE: It is invariant that PONDER_CHECKPOINT has a value for each chain.

  const checkpointTable = `"${namespaceBuild.schema}"."${PONDER_CHECKPOINT_TABLE_NAME}"`;
  const minOperationId = tables
    .map(
      (table) => `
SELECT MIN(operation_id) AS operation_id FROM "${getSchema(table)}"."${getReorgTableName(table)}"
WHERE checkpoint > (
  SELECT finalized_checkpoint FROM ${checkpointTable}
  WHERE chain_id = ${chainIdSql}
)${getExecutedCheckpointsSql(executedCheckpoints)}`,
    )
    .join(" UNION ALL ");

  // Note: The statements of a `WITH` see the same snapshot, so every table is
  // finalized up to the same operation.
  return [
    builder
      .update(PONDER_CHECKPOINT)
      .set({ finalizedCheckpoint: checkpoint })
      .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
    rawSql(`
WITH min_operation AS (
  SELECT MIN(operation_id) AS operation_id FROM (${minOperationId}) AS all_mins
), ${tables
      .map(
        (table, index) => `
deleted_${index} AS (
  DELETE FROM "${getSchema(table)}"."${getReorgTableName(table)}"
  WHERE (SELECT operation_id FROM min_operation) IS NULL
  OR operation_id < (SELECT operation_id FROM min_operation)
  RETURNING checkpoint
)`,
      )
      .join(",")},
safe AS (
  SELECT MAX(checkpoint) AS safe_checkpoint, ${chainIdSql} AS chain_id
  FROM (${tables.map((_, index) => `SELECT checkpoint FROM deleted_${index}`).join(" UNION ALL ")}) AS all_deleted
  GROUP BY ${chainIdSql}
)
UPDATE ${checkpointTable} AS c
SET safe_checkpoint = safe.safe_checkpoint
FROM safe
WHERE c.chain_id = safe.chain_id;`),
  ];
};

export const finalizeIsolated = ({
  checkpoint,
  tables,
  namespaceBuild,
}: {
  checkpoint: string;
  tables: Table[];
  namespaceBuild: NamespaceBuild;
}): Statement[] => {
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);
  const chainId = Number(decodeCheckpoint(checkpoint).chainId);

  return [
    builder
      .update(PONDER_CHECKPOINT)
      .set({ finalizedCheckpoint: checkpoint, safeCheckpoint: checkpoint })
      .where(eq(PONDER_CHECKPOINT.chainId, chainId)),
    ...tables.map((table) =>
      builder
        .delete(getReorgTable(table))
        .where(
          and(
            lte(getReorgTable(table).checkpoint, checkpoint),
            eq(sql`chain_id`, chainId),
          ),
        ),
    ),
  ];
};

/** A statement that moves the operations of the indexed block of `table` to `checkpoint`. */
export const commitBlock = ({
  checkpoint,
  table,
  preBuild,
}: {
  checkpoint: string;
  table: Table;
  preBuild: Pick<PreBuild, "ordering">;
}): Statement => {
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

  return builder.update(reorgTable).set({ checkpoint }).where(whereClause);
};

/** A statement that reverts every operation of the reorg table of `table`. */
export const crashRecovery = ({ table }: { table: Table }): Statement =>
  revert(table, "");
