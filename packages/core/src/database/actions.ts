import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getTableNames } from "@/drizzle/index.js";
import { getColumnCasing, getReorgTable } from "@/drizzle/kit/index.js";
import type { Ordering, SchemaBuild } from "@/internal/types.js";
import { MAX_CHECKPOINT_STRING, decodeCheckpoint } from "@/utils/checkpoint.js";
import { eq, getTableColumns, getTableName } from "drizzle-orm";
import { type PgTable, getTableConfig } from "drizzle-orm/pg-core";
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
  { tables, chainId }: { tables: PgTable[]; chainId?: number },
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
  CREATE OR REPLACE FUNCTION "${schema}".${getTableNames(table).triggerFn(chainId)}
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

        await tx.wrap({ label: "create_trigger" }, async (tx) => {
          await tx.execute(`
CREATE OR REPLACE TRIGGER "${getTableNames(table).trigger(chainId)}"
AFTER INSERT OR UPDATE ON "${schema}"."${getTableName(table)}"
FOR EACH ROW ${chainId === undefined ? "" : `WHEN (NEW.chain_id = ${chainId})`}
EXECUTE FUNCTION "${schema}".${getTableNames(table).triggerFn(chainId)};
`);

          await tx.execute(`
CREATE OR REPLACE TRIGGER "_${getTableNames(table).trigger(chainId)}"
AFTER DELETE ON "${schema}"."${getTableName(table)}"
FOR EACH ROW ${chainId === undefined ? "" : `WHEN (OLD.chain_id = ${chainId})`}
EXECUTE FUNCTION "${schema}".${getTableNames(table).triggerFn(chainId)};
`);
        });
      }),
    );
  });
};

export const dropTriggers = async (
  qb: QB,
  { tables, chainId }: { tables: PgTable[]; chainId?: number },
) => {
  await qb.transaction(async (tx) => {
    await Promise.all(
      tables.map(async (table) => {
        const schema = getTableConfig(table).schema ?? "public";

        await tx.wrap({ label: "drop_trigger" }, async (tx) => {
          await tx.execute(
            `DROP TRIGGER IF EXISTS "${getTableNames(table).trigger(chainId)}" ON "${schema}"."${getTableName(table)}"`,
          );

          await tx.execute(
            `DROP TRIGGER IF EXISTS "_${getTableNames(table).trigger(chainId)}" ON "${schema}"."${getTableName(table)}"`,
          );
        });
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
    ordering: Ordering;
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
      switch (ordering) {
        case "multichain": {
          result = await tx.wrap((tx) =>
            tx.execute(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
  WHERE ${minOperationId!} IS NOT NULL AND operation_id >= ${minOperationId!}
  RETURNING *
), ${baseQuery}`),
          );
          break;
        }
        case "omnichain": {
          result = await tx.wrap((tx) =>
            tx.execute(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
  WHERE checkpoint > '${checkpoint}' RETURNING *
), ${baseQuery}`),
          );
          break;
        }
        case "isolated": {
          result = await tx.wrap((tx) =>
            tx.execute(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
  WHERE checkpoint > '${checkpoint}' AND SUBSTRING(checkpoint, 11, 16)::numeric = ${String(decodeCheckpoint(checkpoint).chainId)} RETURNING *
), ${baseQuery}`),
          );
          break;
        }
      }

      // @ts-ignore
      counts.push(result.rows[0]!.count);
    }

    return counts;
  });
};

export const finalize = async (
  qb: QB,
  {
    checkpoint,
    tables,
    ordering,
  }: { checkpoint: string; tables: PgTable[]; ordering: Ordering },
): Promise<number[]> => {
  return qb.transaction({ label: "finalize" }, async (tx) => {
    switch (ordering) {
      case "multichain":
      case "omnichain": {
        const min_op_id = await tx
          .wrap((tx) =>
            tx.execute(`
SELECT MIN(min_op_id) AS global_min_op_id FROM (
${tables
  .map(
    (table) => `
  SELECT MIN(operation_id) AS min_op_id FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
  WHERE checkpoint > '${checkpoint}'
    `,
  )
  .join(" UNION ALL ")}) AS all_mins            
    `),
          )
          .then((result) => {
            // @ts-ignore
            return result.rows[0]?.global_min_op_id as number | undefined;
          });

        const counts: number[] = [];
        for (const table of tables) {
          const schema = getTableConfig(table).schema ?? "public";
          const result = await tx.wrap((tx) =>
            tx.execute(`
WITH deleted AS (
  DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
  WHERE ${min_op_id} IS NULL OR operation_id < ${min_op_id}
  RETURNING *
) SELECT COUNT(*) FROM deleted AS count; 
`),
          );

          // @ts-ignore
          counts.push(result.rows[0]!.count);
        }
        return counts;
      }
      case "isolated": {
        const counts: number[] = [];
        for (const table of tables) {
          const schema = getTableConfig(table).schema ?? "public";
          const result = await tx.wrap((tx) =>
            tx.execute(`
WITH deleted AS (
  DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
  WHERE checkpoint <= '${checkpoint}' AND  SUBSTRING(checkpoint, 11, 16)::numeric = ${String(decodeCheckpoint(checkpoint).chainId)}
  RETURNING *
) SELECT COUNT(*) FROM deleted AS count; 
`),
          );

          // @ts-ignore
          counts.push(result.rows[0]!.count);
        }

        return counts;
      }
    }
  });
};

export const commitBlock = async (
  qb: QB,
  {
    checkpoint,
    table,
    ordering,
  }: { checkpoint: string; table: PgTable; ordering: Ordering },
) => {
  const chainId = Number(decodeCheckpoint(checkpoint).chainId);
  if (ordering === "isolated") {
    const schema = getTableConfig(table).schema ?? "public";
    await qb.wrap({ label: "commit_block" }, (db) =>
      db.execute(`
UPDATE "${schema}"."${getTableName(getReorgTable(table))}"
SET checkpoint = '${checkpoint}'
WHERE chain_id = ${chainId} AND checkpoint = '${MAX_CHECKPOINT_STRING}'; 
`),
    );
  } else {
    const reorgTable = getReorgTable(table);
    await qb.wrap({ label: "commit_block" }, (db) =>
      db
        .update(reorgTable)
        .set({ checkpoint })
        .where(eq(reorgTable.checkpoint, MAX_CHECKPOINT_STRING)),
    );
  }
};
