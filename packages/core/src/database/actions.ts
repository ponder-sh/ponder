import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getTableNames } from "@/drizzle/index.js";
import { getColumnCasing, getReorgTable } from "@/drizzle/kit/index.js";
import type { SchemaBuild } from "@/internal/types.js";
import { MAX_CHECKPOINT_STRING, decodeCheckpoint } from "@/utils/checkpoint.js";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { type PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { getPonderCheckpointTable } from "./index.js";
import type { QB } from "./queryBuilder.js";

export const createIndexes = async (
  qb: QB,
  { statements }: { statements: SchemaBuild["statements"] },
) => {
  for (const statement of statements.indexes.sql) {
    await qb.transaction({ label: "create_indexes" }, async (tx) => {
      // 60 minutes
      await tx.wrap((tx) => tx.execute("SET statement_timeout = 3600000;"));
      await tx.wrap((tx) => tx.execute(statement));
    });
  }
};

export const createTriggers = async (
  qb: QB,
  { tables }: { tables: PgTable[] },
) => {
  await qb.transaction(async (tx) => {
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
  CREATE OR REPLACE FUNCTION "${schema}".${getTableNames(table).triggerFn}
  RETURNS TRIGGER AS $$
  BEGIN
  IF TG_OP = 'INSERT' THEN
  INSERT INTO "${schema}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
  VALUES (${columnNames.map((name) => `NEW.${name}`).join(",")}, 0, '${MAX_CHECKPOINT_STRING}');
  ELSIF TG_OP = 'UPDATE' THEN
  INSERT INTO "${schema}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
  VALUES (${columnNames.map((name) => `OLD.${name}`).join(",")}, 1, '${MAX_CHECKPOINT_STRING}');
  ELSIF TG_OP = 'DELETE' THEN
  INSERT INTO "${schema}"."${getTableName(getReorgTable(table))}" (${columnNames.join(",")}, operation, checkpoint)
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
  CREATE OR REPLACE TRIGGER "${getTableNames(table).trigger}"
  AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${getTableName(table)}"
  FOR EACH ROW EXECUTE FUNCTION "${schema}".${getTableNames(table).triggerFn};
  `,
          ),
        );
      }),
    );
  });
};

export const dropTriggers = async (
  qb: QB,
  { tables }: { tables: PgTable[] },
) => {
  await qb.transaction(async (tx) => {
    await Promise.all(
      tables.map(async (table) => {
        const schema = getTableConfig(table).schema ?? "public";

        await tx.wrap({ label: "drop_trigger" }, (tx) =>
          tx.execute(
            `DROP TRIGGER IF EXISTS "${getTableNames(table).trigger}" ON "${schema}"."${getTableName(table)}"`,
          ),
        );
      }),
    );
  });
};

export const revert = async (
  qb: QB,
  {
    checkpoint,
    tables,
    ordering,
  }: {
    checkpoint: string;
    tables: PgTable[];
    ordering: "multichain" | "omnichain";
  },
): Promise<number[]> => {
  return qb.transaction({ label: "revert" }, async (tx) => {
    let minOperationId: number | undefined;
    if (ordering === "multichain") {
      minOperationId = await tx
        .wrap((tx) =>
          tx.execute(`
SELECT MIN(min_op_id) AS global_min_op_id FROM (
${tables
  .map(
    (table) => `
SELECT MIN(operation_id) AS min_op_id FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
WHERE SUBSTRING(checkpoint, 11, 16)::numeric = ${String(decodeCheckpoint(checkpoint).chainId)}
AND checkpoint > '${checkpoint}'
`,
  )
  .join(" UNION ALL ")}) AS all_mins             
`),
        )
        .then((result) => {
          // @ts-ignore
          return result.rows[0]?.global_min_op_id as number | undefined;
        });
    }

    const counts: number[] = [];
    for (const table of tables) {
      const primaryKeyColumns = getPrimaryKeyColumns(table);
      const schema = getTableConfig(table).schema ?? "public";

      const baseQuery = `
    reverted2 AS (
      SELECT ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}, MIN(operation_id) AS operation_id FROM reverted1
      GROUP BY ${primaryKeyColumns.map(({ sql }) => `"${sql}"`).join(", ")}
    ), reverted3 AS (
      SELECT ${Object.values(getTableColumns(table))
        .map((column) => `reverted1."${getColumnCasing(column, "snake_case")}"`)
        .join(", ")}, reverted1.operation FROM reverted2
      INNER JOIN reverted1
      ON ${primaryKeyColumns.map(({ sql }) => `reverted2."${sql}" = reverted1."${sql}"`).join("AND ")}
      AND reverted2.operation_id = reverted1.operation_id
    ), inserted AS (
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

      let result: unknown;
      if (ordering === "multichain") {
        result = await tx.wrap((tx) =>
          tx.execute(`
WITH reverted1 AS (
DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
WHERE ${minOperationId!} IS NOT NULL AND operation_id >= ${minOperationId!}
RETURNING * 
), ${baseQuery}`),
        );
      } else {
        result = await tx.wrap((tx) =>
          tx.execute(`
WITH reverted1 AS (
DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
WHERE checkpoint > '${checkpoint}' RETURNING *
), ${baseQuery}`),
        );
      }

      // @ts-ignore
      counts.push(result.rows[0]!.count);
    }

    return counts;
  });
};

export const finalize = async (
  qb: QB,
  { checkpoint, tables }: { checkpoint: string; tables: PgTable[] },
): Promise<number> => {
  const PONDER_CHECKPOINT = getPonderCheckpointTable();
  return qb.transaction({ label: "finalize" }, async (tx) => {
    const schema = getTableConfig(PONDER_CHECKPOINT).schema ?? "public";
    // It is invariant that PONDER_CHECKPOINT is initialized before the finalzied call for each chainId
    await tx.wrap((tx) =>
      tx
        .update(PONDER_CHECKPOINT)
        .set({
          finalizedCheckpoint: checkpoint as string,
        })
        .where(
          eq(
            PONDER_CHECKPOINT.chainId,
            Number(decodeCheckpoint(checkpoint).chainId),
          ),
        ),
    );

    const min_op_id = await tx
      .wrap((tx) =>
        tx.execute(`
SELECT MIN(min_op_id) AS global_min_op_id FROM (
${tables
  .map(
    (table) => `
SELECT MIN(operation_id) AS min_op_id FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
WHERE checkpoint > (
  SELECT finalized_checkpoint 
  FROM "${schema}"."${getTableName(PONDER_CHECKPOINT)}" 
  WHERE chain_id = SUBSTRING(checkpoint, 11, 16)::numeric
)
`,
  )
  .join(" UNION ALL ")}) AS all_mins
`),
      )
      .then((result) => {
        // @ts-ignore
        return result.rows[0]?.global_min_op_id as number | undefined;
      });

    let count = 0;
    if (tables.length > 0) {
      const result = await tx.wrap((tx) =>
        tx.execute(`
WITH ${tables
          .map(
            (table, index) => `
deleted_${index} AS (
  DELETE FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
  ${min_op_id === undefined ? "" : `WHERE operation_id < ${min_op_id}`}
  RETURNING *
)`,
          )
          .join(",\n")},
all_deleted AS (
  ${tables
    .map((_, index) => `SELECT * FROM deleted_${index}`)
    .join(" UNION ALL ")}
)
SELECT MAX(checkpoint) as safe_checkpoint, SUBSTRING(checkpoint, 11, 16)::numeric as chain_id, COUNT(*) AS deleted_count 
FROM all_deleted
GROUP BY SUBSTRING(checkpoint, 11, 16)::numeric;
`),
      );

      for (const { chain_id, safe_checkpoint, deleted_count } of result.rows) {
        count += deleted_count as number;

        await tx.wrap((tx) =>
          tx
            .update(PONDER_CHECKPOINT)
            .set({
              safeCheckpoint: safe_checkpoint as string,
            })
            .where(eq(PONDER_CHECKPOINT.chainId, chain_id as number)),
        );
      }
    }

    return count;
  });
};

export const commitBlock = async (
  qb: QB,
  { checkpoint, table }: { checkpoint: string; table: PgTable },
) => {
  const reorgTable = getReorgTable(table);
  await qb.wrap({ label: "commit_block" }, (db) =>
    db
      .update(reorgTable)
      .set({ checkpoint })
      .where(eq(reorgTable.checkpoint, MAX_CHECKPOINT_STRING)),
  );
};
