import { getPrimaryKeyColumns } from "@/drizzle/index.js";
import { getTableNames } from "@/drizzle/index.js";
import { getColumnCasing, getReorgTable } from "@/drizzle/kit/index.js";
import type {
  NamespaceBuild,
  PreBuild,
  SchemaBuild,
} from "@/internal/types.js";
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

export const createViews = async (
  qb: QB,
  {
    tables,
    namespaceBuild,
  }: { tables: PgTable[]; namespaceBuild: NamespaceBuild },
) => {
  await qb.transaction({ label: "create_views" }, async (tx) => {
    await tx.wrap((tx) =>
      tx.execute(`CREATE SCHEMA IF NOT EXISTS "${namespaceBuild.viewsSchema}"`),
    );

    for (const table of tables) {
      // Note: drop views before creating new ones to avoid enum errors.
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

    const trigger = `status_${namespaceBuild.viewsSchema}_trigger`;
    const notification = "status_notify()";
    const channel = `${namespaceBuild.viewsSchema}_status_channel`;

    await tx.wrap((tx) =>
      tx.execute(`
CREATE OR REPLACE FUNCTION "${namespaceBuild.viewsSchema}".${notification}
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
NOTIFY "${channel}";
RETURN NULL;
END;
$$;`),
    );

    await tx.wrap((tx) =>
      tx.execute(`
CREATE OR REPLACE TRIGGER "${trigger}"
AFTER INSERT OR UPDATE OR DELETE
ON "${namespaceBuild.schema}"._ponder_checkpoint
FOR EACH STATEMENT
EXECUTE PROCEDURE "${namespaceBuild.viewsSchema}".${notification};`),
    );
  });
};

export const revert = async (
  qb: QB,
  {
    checkpoint,
    tables,
    preBuild,
  }: {
    checkpoint: string;
    tables: PgTable[];
    preBuild: Pick<PreBuild, "ordering">;
  },
): Promise<number[]> => {
  return qb.transaction({ label: "revert" }, async (tx) => {
    const counts: number[] = [];
    if (preBuild.ordering === "multichain") {
      const minOperationId = await tx
        .wrap((tx) =>
          tx.execute(`
SELECT MIN(operation_id) AS operation_id FROM (
${tables
  .map(
    (table) => `
SELECT MIN(operation_id) AS operation_id FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
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
  DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
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
    } else if (preBuild.ordering === "omnichain") {
      for (const table of tables) {
        const primaryKeyColumns = getPrimaryKeyColumns(table);
        const schema = getTableConfig(table).schema ?? "public";

        const result = await tx.wrap((tx) =>
          tx.execute(`
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
), ${getRevertSql({ table })};`),
        );

        // @ts-ignore
        counts.push(result.rows[0]!.count);
      }
    } else {
      for (const table of tables) {
        const primaryKeyColumns = getPrimaryKeyColumns(table);
        const schema = getTableConfig(table).schema ?? "public";

        const result = await tx.wrap((tx) =>
          tx.execute(`
WITH reverted1 AS (
  DELETE FROM "${schema}"."${getTableName(getReorgTable(table))}"
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
    }

    return counts;
  });
};

export const finalize = async (
  qb: QB,
  {
    checkpoint,
    tables,
    preBuild,
    namespaceBuild,
  }: {
    checkpoint: string;
    tables: PgTable[];
    preBuild: Pick<PreBuild, "ordering">;
    namespaceBuild: NamespaceBuild;
  },
): Promise<number> => {
  const PONDER_CHECKPOINT = getPonderCheckpointTable(namespaceBuild.schema);

  // NOTE: It is invariant that PONDER_CHECKPOINT has a value for each chain.

  return qb.transaction({ label: "finalize" }, async (tx) => {
    let count = 0;

    if (preBuild.ordering === "multichain") {
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
    SELECT MAX(checkpoint) as safe_checkpoint, SUBSTRING(checkpoint, 11, 16)::numeric as chain_id, COUNT(*) AS deleted_count 
    FROM all_deleted
    GROUP BY SUBSTRING(checkpoint, 11, 16)::numeric;`),
      );

      for (const { chain_id, safe_checkpoint, deleted_count } of result.rows) {
        count += Number(deleted_count);

        await tx.wrap((tx) =>
          tx
            .update(PONDER_CHECKPOINT)
            .set({ safeCheckpoint: safe_checkpoint as string })
            .where(eq(PONDER_CHECKPOINT.chainId, chain_id as number)),
        );
      }
    } else if (preBuild.ordering === "omnichain") {
      await tx.wrap((tx) =>
        tx
          .update(PONDER_CHECKPOINT)
          .set({ finalizedCheckpoint: checkpoint, safeCheckpoint: checkpoint }),
      );

      for (const table of tables) {
        count += await tx
          .wrap((tx) =>
            tx.execute(`
WITH deleted AS (
  DELETE FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
  WHERE checkpoint <= '${checkpoint}'
  RETURNING *
) SELECT COUNT(*) AS deleted_count FROM deleted;`),
          )
          .then((result) => Number(result.rows[0]!.deleted_count));
      }
    } else {
      await tx.wrap((tx) =>
        tx
          .update(PONDER_CHECKPOINT)
          .set({ finalizedCheckpoint: checkpoint, safeCheckpoint: checkpoint })
          .where(
            eq(
              PONDER_CHECKPOINT.chainId,
              Number(decodeCheckpoint(checkpoint).chainId),
            ),
          ),
      );

      for (const table of tables) {
        count += await tx
          .wrap((tx) =>
            tx.execute(`
WITH deleted AS (
  DELETE FROM "${getTableConfig(table).schema ?? "public"}"."${getTableName(getReorgTable(table))}"
  WHERE checkpoint <= '${checkpoint}' AND SUBSTRING(checkpoint, 11, 16)::numeric = ${String(decodeCheckpoint(checkpoint).chainId)}
  RETURNING *
) SELECT COUNT(*) AS deleted_count FROM deleted;`),
          )
          .then((result) => Number(result.rows[0]!.deleted_count));
      }
    }

    return count;
  });
};

export const commitBlock = async (
  qb: QB,
  {
    checkpoint,
    table,
    preBuild,
  }: {
    checkpoint: string;
    table: PgTable;
    preBuild: Pick<PreBuild, "ordering">;
  },
) => {
  const chainId = Number(decodeCheckpoint(checkpoint).chainId);
  if (preBuild.ordering === "isolated") {
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

export const crashRecovery = async (qb: QB, { table }: { table: PgTable }) => {
  const primaryKeyColumns = getPrimaryKeyColumns(table);
  const schema = getTableConfig(table).schema ?? "public";

  await qb.wrap((db) =>
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
  );
};

export const getRevertSql = ({ table }: { table: PgTable }) => {
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
