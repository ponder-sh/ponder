import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getTableNames } from "@/drizzle/index.js";
import { getColumnCasing, getReorgTable } from "@/drizzle/kit/index.js";
import type { SchemaBuild } from "@/internal/types.js";
import { MAX_CHECKPOINT_STRING } from "@/utils/checkpoint.js";
import { eq, getTableColumns, getTableName, lte, sql } from "drizzle-orm";
import { type PgTable, getTableConfig } from "drizzle-orm/pg-core";
import type { QB } from "./queryBuilder.js";

export const createIndexes = async (
  qb: QB,
  { statements }: { statements: SchemaBuild["statements"] },
) => {
  for (const statement of statements.indexes.sql) {
    await qb.label("create_indexes").transaction(async (tx) => {
      await tx.label("update_statement_timeout").execute(
        // 60 minutes
        "SET statement_timeout = 3600000;",
      );
      await tx.label("create_index").execute(statement);
    });
  }
};

export const createTrigger = async (qb: QB, { table }: { table: PgTable }) => {
  const schema = getTableConfig(table).schema ?? "public";
  const columns = getTableColumns(table);

  const columnNames = Object.values(columns).map(
    (column) => `"${getColumnCasing(column, "snake_case")}"`,
  );

  await qb.label("create_trigger_function").execute(
    sql.raw(`
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
$$ LANGUAGE plpgsql`),
  );

  await qb.label("create_trigger").execute(
    sql.raw(`
CREATE OR REPLACE TRIGGER "${getTableNames(table).trigger}"
AFTER INSERT OR UPDATE OR DELETE ON "${schema}"."${getTableName(table)}"
FOR EACH ROW EXECUTE FUNCTION "${schema}".${getTableNames(table).triggerFn};
`),
  );
};

export const dropTrigger = async (qb: QB, { table }: { table: PgTable }) => {
  const schema = getTableConfig(table).schema ?? "public";

  await qb
    .label("drop_trigger")
    .execute(
      sql.raw(
        `DROP TRIGGER IF EXISTS "${getTableNames(table).trigger}" ON "${schema}"."${getTableName(table)}"`,
      ),
    );
};

export const revert = async (
  qb: QB,
  { checkpoint, table }: { checkpoint: string; table: PgTable },
): Promise<number> => {
  const primaryKeyColumns = getPrimaryKeyColumns(table);
  const schema = getTableConfig(table).schema ?? "public";

  const result = await qb.label("revert").execute(
    sql.raw(`
WITH reverted1 AS (
DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
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
) SELECT COUNT(*) FROM reverted1 as count;
`),
  );

  return result.rows[0]!.count as number;
};

export const finalize = async (
  qb: QB,
  { checkpoint, table }: { checkpoint: string; table: PgTable },
) => {
  await qb
    .label("finalize")
    .delete(getReorgTable(table))
    .where(lte(getReorgTable(table).checkpoint, checkpoint));
};

export const commitBlock = async (
  qb: QB,
  { checkpoint, table }: { checkpoint: string; table: PgTable },
) => {
  const reorgTable = getReorgTable(table);
  await qb
    .label("commit_block")
    .update(reorgTable)
    .set({ checkpoint })
    .where(eq(reorgTable.checkpoint, MAX_CHECKPOINT_STRING));
};
