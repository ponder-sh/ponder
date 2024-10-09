import {
  InvalidStoreMethodError,
  RecordNotFoundError,
} from "@/common/errors.js";
import type { Database } from "@/database/index.js";
import { type Schema, onchain } from "@/drizzle/index.js";
import type { Db } from "@/types/db.js";
import { type SQL, type Table, and, eq } from "drizzle-orm";
import { type PgTable, getTableConfig } from "drizzle-orm/pg-core";

export type IndexingStore = Db<Schema>;

const getKeyConditional = (table: Table, key: Object): SQL<unknown> => {
  // @ts-ignore
  return and(
    // @ts-ignore
    ...Object.entries(key).map(([column, value]) => eq(table[column], value)),
  );
};

const checkOnchainTable = (
  table: Table,
  method: "find" | "insert" | "update" | "upsert" | "delete",
) => {
  if (onchain in table) return;

  throw new InvalidStoreMethodError(
    method === "find"
      ? `db.find() can only be used with onchain tables, and '${getTableConfig(table).name}' is an offchain table.`
      : `Indexing functions can only write to onchain tables, and '${getTableConfig(table).name}' is an offchain table.`,
  );
};

export const createIndexingStore = ({
  database,
}: { database: Database }): IndexingStore => {
  const wrap = database.qb.user.wrap;

  const indexingStore = {
    find: (table, key) =>
      // @ts-ignore
      wrap({ method: `${getTableConfig(table).name}.find()` }, () => {
        checkOnchainTable(table as Table, "find");
        return database.drizzle
          .select()
          .from(table as PgTable)
          .where(getKeyConditional(table as PgTable, key))
          .then((res) => (res.length === 0 ? undefined : res[0]));
      }),
    insert(table) {
      return {
        values: (values: any) =>
          wrap(
            { method: `${getTableConfig(table as PgTable).name}.insert()` },
            async () => {
              checkOnchainTable(table as Table, "insert");
              await database.drizzle.insert(table as PgTable).values(values);
            },
          ),
      };
    },
    // @ts-ignore
    update(table, key) {
      return {
        set: (values: any) =>
          wrap(
            { method: `${getTableConfig(table as PgTable).name}.update()` },
            async () => {
              checkOnchainTable(table as Table, "update");
              if (typeof values === "function") {
                // @ts-ignore
                const row = await indexingStore.find(table, key);

                if (row === undefined) {
                  throw new RecordNotFoundError(
                    "No existing record was found with the specified ID",
                  );
                }

                await indexingStore.update(table, key).set(values(row));
              } else {
                await database.drizzle
                  .update(table as PgTable)
                  .set(values)
                  .where(getKeyConditional(table as PgTable, key));
              }
            },
          ),
      };
    },
    // @ts-ignore
    upsert(table, key) {
      return {
        insert(valuesI: any) {
          return {
            update: (valuesU: any) =>
              wrap(
                { method: `${getTableConfig(table as PgTable).name}.upsert()` },
                async () => {
                  checkOnchainTable(table as Table, "upsert");
                  // @ts-ignore
                  const row = await indexingStore.find(table, key);

                  if (row === undefined) {
                    await indexingStore
                      .insert(table)
                      .values({ ...key, ...valuesI });
                  } else {
                    if (typeof valuesU === "function") {
                      const values = valuesU(row);
                      await indexingStore.update(table, key).set(values);
                    } else {
                      await indexingStore.update(table, key).set(valuesU);
                    }
                  }
                },
              ),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: () =>
              wrap(
                { method: `${getTableConfig(table as PgTable).name}.upsert()` },
                async () => {
                  checkOnchainTable(table as Table, "upsert");
                  // @ts-ignore
                  const row = await indexingStore.find(table, key);
                  if (row === undefined) {
                    await indexingStore
                      .insert(table)
                      .values({ ...key, ...valuesI });
                  }
                },
              ),
          };
        },
        update(valuesU: any) {
          return {
            insert: (valuesI: any) =>
              wrap(
                { method: `${getTableConfig(table as PgTable).name}.upsert()` },
                async () => {
                  checkOnchainTable(table as Table, "upsert");
                  // @ts-ignore
                  const row = await indexingStore.find(table, key);

                  if (row === undefined) {
                    await indexingStore
                      .insert(table)
                      .values({ ...key, ...valuesI });
                  } else {
                    if (typeof valuesU === "function") {
                      const values = valuesU(row);
                      await indexingStore.update(table, key).set(values);
                    } else {
                      await indexingStore.update(table, key).set(valuesU);
                    }
                  }
                },
              ),
            // biome-ignore lint/suspicious/noThenProperty: <explanation>
            then: () =>
              wrap(
                { method: `${getTableConfig(table as PgTable).name}.upsert()` },
                async () => {
                  checkOnchainTable(table as Table, "upsert");
                  const row = await indexingStore.find(
                    // @ts-ignore
                    table as Table & { [onchain]: true },
                    key,
                  );
                  if (row !== undefined) {
                    if (typeof valuesU === "function") {
                      const values = valuesU(row);
                      await indexingStore.update(table, key).set(values);
                    } else {
                      await indexingStore.update(table, key).set(valuesU);
                    }
                  }
                },
              ),
          };
        },
      };
    },
    delete: (table, key) =>
      wrap(
        { method: `${getTableConfig(table as PgTable).name}.delete()` },
        async () => {
          checkOnchainTable(table as Table, "upsert");
          await database.drizzle
            .delete(table as Table)
            .where(getKeyConditional(table as Table, key));
        },
      ),
    sql: database.drizzle,
  } satisfies IndexingStore;

  // @ts-ignore
  return indexingStore;
};
