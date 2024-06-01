import { NonRetryableError } from "@/common/errors.js";
import type { Logger } from "@/common/logger.js";
import { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema, Table } from "@/schema/common.js";
import { getTables } from "@/schema/utils.js";
import type { DatabaseRecord, UserId, UserRecord } from "@/types/schema.js";
import { getReadonlyStore } from "./readonly.js";
import type { HistoricalStore, OrderByInput, WhereInput } from "./store.js";
import { decodeRow, encodeRow, encodeValue } from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";

const MAX_BATCH_SIZE = 1_000 as const;
// @ts-expect-error
const DEFAULT_LIMIT = 50 as const;
// @ts-expect-error
const MAX_LIMIT = 1_000 as const;

type Insert = {
  type: "insert";
  record: UserRecord;
};

type StoreCache = {
  [tableName: string]: { [id: Exclude<UserId, bigint>]: Insert };
};

export const getHistoricalStore = ({
  kind,
  schema,
  namespaceInfo,
  db,
  logger,
}: {
  kind: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
  logger: Logger;
}): HistoricalStore => {
  const storeCache: StoreCache = {};
  const isCacheFull = true;

  const readonlyStore = getReadonlyStore({ kind, schema, namespaceInfo, db });

  for (const tableName of Object.keys(getTables(schema))) {
    storeCache[tableName] = {};
  }

  return {
    findUnique: async ({
      tableName,
      id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      if (isCacheFull) {
        return storeCache[tableName][id as string | number]?.record ?? null;
      } else {
        return readonlyStore.findUnique({ tableName, id });
      }
    },
    findMany: async (_: {
      tableName: string;
      where?: WhereInput<any>;
      orderBy?: OrderByInput<any>;
      before?: string | null;
      after?: string | null;
      limit?: number;
    }) => {
      throw new NonRetryableError("Not implemented");
    },
    create: async ({
      tableName,
      id,
      data = {},
    }: {
      tableName: string;
      id: UserId;
      data?: Omit<UserRecord, "id">;
    }) => {
      // TODO: check for missing columns

      if (storeCache[tableName][id as number | string] !== undefined) {
        // TODO: throw error
      }
      const record: UserRecord = { id, ...data };

      storeCache[tableName][id as number | string] = {
        type: "insert",
        record,
      };

      return record;
    },
    createMany: async ({
      tableName,
      data,
    }: {
      tableName: string;
      data: UserRecord[];
    }) => {
      const table = (schema[tableName] as { table: Table }).table;

      const rows: DatabaseRecord[] = [];

      for (let i = 0, len = data.length; i < len; i += MAX_BATCH_SIZE) {
        await db.wrap({ method: `${tableName}.createMany` }, async () => {
          const createRows = data
            .slice(i, i + MAX_BATCH_SIZE)
            .map((d) => encodeRow(d, table, kind));

          const _rows = await db
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRows)
            .returningAll()
            .execute()
            .catch((err) => {
              throw parseStoreError(err, data.length > 0 ? data[0] : {});
            });

          rows.push(..._rows);
        });
      }

      return rows.map((row) => decodeRow(row, table, kind));
    },
    update: async ({
      tableName,
      id,
      data = {},
    }: {
      tableName: string;
      id: UserId;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      const oldRecord = storeCache[tableName][id as number | string]?.record;

      if (oldRecord === undefined) {
        // TODO: throw error
      }

      const update =
        typeof data === "function" ? data({ current: oldRecord }) : data;

      const newRecord: UserRecord = {
        ...oldRecord,
        ...update,
      };

      storeCache[tableName][id as number | string].record = newRecord;

      return newRecord;
    },
    updateMany: async (_: {
      tableName: string;
      where: WhereInput<any>;
      data?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      throw new NonRetryableError("Not implemented");
    },
    upsert: async ({
      tableName,
      id,
      create = {},
      update = {},
    }: {
      tableName: string;
      id: UserId;
      create?: Omit<UserRecord, "id">;
      update?:
        | Partial<Omit<UserRecord, "id">>
        | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
    }) => {
      const oldRecord = storeCache[tableName][id as number | string]?.record;

      if (oldRecord === undefined) {
        // TODO: check for missing columns

        const record: UserRecord = { id, ...create };

        storeCache[tableName][id as number | string] = {
          type: "insert",
          record,
        };

        return record;
      } else {
        const _update =
          typeof update === "function"
            ? update({ current: oldRecord })
            : update;

        const newRecord: UserRecord = {
          ...oldRecord,
          ..._update,
        };

        storeCache[tableName][id as number | string].record = newRecord;

        return newRecord;
      }
    },
    delete: async ({
      tableName,
      id,
    }: {
      tableName: string;
      id: UserId;
    }) => {
      const table = (schema[tableName] as { table: Table }).table;

      return db.wrap({ method: `${tableName}.delete` }, async () => {
        const encodedId = encodeValue(id, table.id, kind);

        const deletedRow = await db
          .withSchema(namespaceInfo.userNamespace)
          .deleteFrom(tableName)
          .where("id", "=", encodedId)
          .returning(["id"])
          .executeTakeFirst()
          .catch((err) => {
            throw parseStoreError(err, { id });
          });

        return !!deletedRow;
      });
    },
    flush: async () => {
      await Promise.all(
        Object.entries(storeCache).map(
          async ([tableName, tableStoreCache]) => {
            const table = (schema[tableName] as { table: Table }).table;

            const rows = Object.values(tableStoreCache).map(
              ({ record }) => record,
            );

            logger.debug({
              service: "indexing",
              msg: `Flushing ${rows.length} '${tableName}' database records from cache`,
            });

            for (let i = 0, len = rows.length; i < len; i += MAX_BATCH_SIZE) {
              await db.wrap({ method: `${tableName}.flush` }, async () => {
                const _rows = rows
                  .slice(i, i + MAX_BATCH_SIZE)
                  .map((d) => encodeRow(d, table, kind));

                await db
                  .withSchema(namespaceInfo.userNamespace)
                  .insertInto(tableName)
                  .values(_rows)
                  .execute()
                  .catch((err) => {
                    throw parseStoreError(
                      err,
                      _rows.length > 0 ? _rows[0] : {},
                    );
                  });
              });
            }
          },
        ),
      );
    },
  };
};
