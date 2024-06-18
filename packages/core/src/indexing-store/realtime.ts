import type { Common } from "@/common/common.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema, Table } from "@/schema/common.js";
import type {
  DatabaseRecord,
  DatabaseValue,
  UserId,
  UserRecord,
} from "@/types/schema.js";
import type { WhereInput, WriteStore } from "./store.js";
import { decodeRecord, encodeRecord, encodeValue } from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";
import { buildWhereConditions } from "./utils/filter.js";

export const getRealtimeStore = ({
  encoding,
  schema,
  namespaceInfo,
  db,
  common,
}: {
  encoding: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
  common: Common;
}): WriteStore<"realtime"> => ({
  create: ({
    tableName,
    encodedCheckpoint,
    id,
    data = {},
  }: {
    tableName: string;
    encodedCheckpoint: string;
    id: UserId;
    data?: Omit<UserRecord, "id">;
  }) => {
    const table = (schema[tableName] as { table: Table }).table;

    return db.wrap({ method: `${tableName}.create` }, async () => {
      const createRecord = encodeRecord({
        record: { id, ...data },
        table,
        encoding,
        schema,
        skipValidation: false,
      });

      return await db.transaction().execute(async (tx) => {
        const record = await tx
          .withSchema(namespaceInfo.userNamespace)
          .insertInto(tableName)
          .values(createRecord)
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, ...data });
          });

        await tx
          .withSchema(namespaceInfo.internalNamespace)
          .insertInto(namespaceInfo.internalTableIds[tableName]!)
          .values({
            operation: 0,
            id: createRecord.id,
            checkpoint: encodedCheckpoint,
          })
          .execute();

        return decodeRecord({ record: record, table, encoding });
      });
    });
  },
  createMany: ({
    tableName,
    encodedCheckpoint,
    data,
  }: {
    tableName: string;
    encodedCheckpoint: string;
    data: UserRecord[];
  }) => {
    const table = (schema[tableName] as { table: Table }).table;

    return db.wrap({ method: `${tableName}.createMany` }, async () => {
      const records: DatabaseRecord[] = [];
      await db.transaction().execute(async (tx) => {
        const batchSize = Math.round(
          common.options.databaseMaxQueryParameters / Object.keys(table).length,
        );
        for (let i = 0, len = data.length; i < len; i += batchSize) {
          const createRecords = data.slice(i, i + batchSize).map((d) =>
            encodeRecord({
              record: d,
              table,
              encoding,
              schema,
              skipValidation: false,
            }),
          );

          const _records = await tx
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRecords)
            .returningAll()
            .execute()
            .catch((err) => {
              throw parseStoreError(err, data.length > 0 ? data[0]! : {});
            });

          records.push(..._records);

          await tx
            .withSchema(namespaceInfo.internalNamespace)
            .insertInto(namespaceInfo.internalTableIds[tableName]!)
            .values(
              createRecords.map((record) => ({
                operation: 0,
                id: record.id,
                checkpoint: encodedCheckpoint,
              })),
            )
            .execute();
        }
      });

      return records.map((record) => decodeRecord({ record, table, encoding }));
    });
  },
  update: ({
    tableName,
    encodedCheckpoint,
    id,
    data = {},
  }: {
    tableName: string;
    encodedCheckpoint: string;
    id: UserId;
    data?:
      | Partial<Omit<UserRecord, "id">>
      | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
  }) => {
    const table = (schema[tableName] as { table: Table }).table;

    return db.wrap({ method: `${tableName}.update` }, async () => {
      const encodedId = encodeValue({ value: id, column: table.id, encoding });

      const record = await db.transaction().execute(async (tx) => {
        const latestRecord = await tx
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, data: "(function)" });
          });

        const updateObject =
          typeof data === "function"
            ? data({
                current: decodeRecord({
                  record: latestRecord,
                  table,
                  encoding,
                }),
              })
            : data;
        const updateRecord = encodeRecord({
          record: { id, ...updateObject },
          table,
          encoding,
          schema,
          skipValidation: false,
        });

        const updateResult = await tx
          .withSchema(namespaceInfo.userNamespace)
          .updateTable(tableName)
          .set(updateRecord)
          .where("id", "=", encodedId)
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, ...updateObject });
          });

        await tx
          .withSchema(namespaceInfo.internalNamespace)
          .insertInto(namespaceInfo.internalTableIds[tableName]!)
          .values({
            operation: 1,
            checkpoint: encodedCheckpoint,
            ...latestRecord,
          })
          .execute();

        return updateResult;
      });

      const result = decodeRecord({ record: record, table, encoding });

      return result;
    });
  },
  updateMany: async ({
    tableName,
    encodedCheckpoint,
    where,
    data = {},
  }: {
    tableName: string;
    encodedCheckpoint: string;
    where: WhereInput<any>;
    data?:
      | Partial<Omit<UserRecord, "id">>
      | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
  }) => {
    const table = (schema[tableName] as { table: Table }).table;

    const records: UserRecord[] = [];
    let cursor: DatabaseValue = null;

    while (true) {
      const _records = await db.wrap(
        { method: `${tableName}.updateMany` },
        () =>
          db.transaction().execute(async (tx) => {
            const latestRecords: DatabaseRecord[] = await tx
              .withSchema(namespaceInfo.userNamespace)
              .selectFrom(tableName)
              .selectAll()
              .where((eb) =>
                buildWhereConditions({
                  eb,
                  where,
                  table,
                  encoding,
                }),
              )
              .orderBy("id", "asc")
              .limit(common.options.databaseMaxRowLimit)
              .$if(cursor !== null, (qb) => qb.where("id", ">", cursor))
              .execute();

            const records: DatabaseRecord[] = [];

            for (const latestRecord of latestRecords) {
              const updateObject =
                typeof data === "function"
                  ? data({
                      current: decodeRecord({
                        record: latestRecord,
                        table,
                        encoding,
                      }),
                    })
                  : data;

              // Here, `latestRecord` is already encoded, so we need to exclude it from `encodeRecord`.
              const updateRecord = {
                id: latestRecord.id,
                ...encodeRecord({
                  record: updateObject,
                  table,
                  encoding,
                  schema,
                  skipValidation: false,
                }),
              };

              const record = await tx
                .withSchema(namespaceInfo.userNamespace)
                .updateTable(tableName)
                .set(updateRecord)
                .where("id", "=", latestRecord.id)
                .returningAll()
                .executeTakeFirstOrThrow()
                .catch((err) => {
                  throw parseStoreError(err, updateObject);
                });

              records.push(record);

              await tx
                .withSchema(namespaceInfo.internalNamespace)
                .insertInto(namespaceInfo.internalTableIds[tableName]!)
                .values({
                  operation: 1,
                  checkpoint: encodedCheckpoint,
                  ...latestRecord,
                })
                .execute();
            }

            return records.map((record) =>
              decodeRecord({ record, table, encoding }),
            );
          }),
      );

      records.push(..._records);

      if (_records.length === 0) {
        break;
      } else {
        cursor = encodeValue({
          value: _records[_records.length - 1]!.id,
          column: table.id,
          encoding,
        });
      }
    }

    return records;
  },
  upsert: ({
    tableName,
    encodedCheckpoint,
    id,
    create = {},
    update = {},
  }: {
    tableName: string;
    encodedCheckpoint: string;
    id: UserId;
    create?: Omit<UserRecord, "id">;
    update?:
      | Partial<Omit<UserRecord, "id">>
      | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
  }) => {
    const table = (schema[tableName] as { table: Table }).table;

    return db.wrap({ method: `${tableName}.upsert` }, async () => {
      const encodedId = encodeValue({ value: id, column: table.id, encoding });
      const createRecord = encodeRecord({
        record: { id, ...create },
        table,
        encoding,
        schema,
        skipValidation: false,
      });

      const record = await db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRecord = await tx
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();

        // If there is no latest version, insert a new version using the create data.
        if (latestRecord === undefined) {
          const record = await tx
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRecord)
            .returningAll()
            .executeTakeFirstOrThrow()
            .catch((err) => {
              const prettyObject: any = { id };
              for (const [key, value] of Object.entries(create))
                prettyObject[`create.${key}`] = value;
              if (typeof update === "function") {
                prettyObject.update = "(function)";
              } else {
                for (const [key, value] of Object.entries(update))
                  prettyObject[`update.${key}`] = value;
              }
              throw parseStoreError(err, prettyObject);
            });

          await tx
            .withSchema(namespaceInfo.internalNamespace)
            .insertInto(namespaceInfo.internalTableIds[tableName]!)
            .values({
              operation: 0,
              id: createRecord.id,
              checkpoint: encodedCheckpoint,
            })
            .execute();

          return record;
        }

        const updateObject =
          typeof update === "function"
            ? update({
                current: decodeRecord({
                  record: latestRecord,
                  table,
                  encoding,
                }),
              })
            : update;
        const updateRecord = encodeRecord({
          record: { id, ...updateObject },
          table,
          encoding,
          schema,
          skipValidation: false,
        });

        const record = await tx
          .withSchema(namespaceInfo.userNamespace)
          .updateTable(tableName)
          .set(updateRecord)
          .where("id", "=", encodedId)
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((err) => {
            const prettyObject: any = { id };
            for (const [key, value] of Object.entries(create))
              prettyObject[`create.${key}`] = value;
            for (const [key, value] of Object.entries(updateObject))
              prettyObject[`update.${key}`] = value;
            throw parseStoreError(err, prettyObject);
          });

        await tx
          .withSchema(namespaceInfo.internalNamespace)
          .insertInto(namespaceInfo.internalTableIds[tableName]!)
          .values({
            operation: 1,
            checkpoint: encodedCheckpoint,
            ...latestRecord,
          })
          .execute();

        return record;
      });

      return decodeRecord({ record, table, encoding });
    });
  },
  delete: ({
    tableName,
    encodedCheckpoint,
    id,
  }: {
    tableName: string;
    encodedCheckpoint: string;
    id: UserId;
  }) => {
    const table = (schema[tableName] as { table: Table }).table;

    return db.wrap({ method: `${tableName}.delete` }, async () => {
      const encodedId = encodeValue({ value: id, column: table.id, encoding });

      const isDeleted = await db.transaction().execute(async (tx) => {
        const record = await tx
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();

        const deletedRecord = await tx
          .withSchema(namespaceInfo.userNamespace)
          .deleteFrom(tableName)
          .where("id", "=", encodedId)
          .returning(["id"])
          .executeTakeFirst()
          .catch((err) => {
            throw parseStoreError(err, { id });
          });

        if (record !== undefined) {
          await tx
            .withSchema(namespaceInfo.internalNamespace)
            .insertInto(namespaceInfo.internalTableIds[tableName]!)
            .values({
              operation: 2,
              checkpoint: encodedCheckpoint,
              ...record,
            })
            .execute();
        }

        return !!deletedRecord;
      });

      return isDeleted;
    });
  },
});
