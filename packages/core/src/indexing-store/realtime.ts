import type { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema, Table } from "@/schema/common.js";
import type { DatabaseRecord, UserId, UserRecord } from "@/types/schema.js";
import type { WhereInput, WriteStore } from "./store.js";
import { decodeRow, encodeRow, encodeValue } from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";
import { buildWhereConditions } from "./utils/filter.js";

const MAX_BATCH_SIZE = 1_000 as const;

export const getRealtimeStore = ({
  kind,
  schema,
  namespaceInfo,
  db,
}: {
  kind: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
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
      const createRow = encodeRow({ id, ...data }, table, kind);

      return await db.transaction().execute(async (tx) => {
        const row = await tx
          .withSchema(namespaceInfo.userNamespace)
          .insertInto(tableName)
          .values(createRow)
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, ...data });
          });

        await tx
          .withSchema(namespaceInfo.internalNamespace)
          .insertInto(namespaceInfo.internalTableIds[tableName])
          .values({
            operation: 0,
            id: createRow.id,
            checkpoint: encodedCheckpoint,
          })
          .execute();

        return decodeRow(row, table, kind);
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
      const rows: DatabaseRecord[] = [];
      await db.transaction().execute(async (tx) => {
        for (let i = 0, len = data.length; i < len; i += MAX_BATCH_SIZE) {
          const createRows = data
            .slice(i, i + MAX_BATCH_SIZE)
            .map((d) => encodeRow(d, table, kind));

          const _rows = await tx
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRows)
            .returningAll()
            .execute()
            .catch((err) => {
              throw parseStoreError(err, data.length > 0 ? data[0] : {});
            });

          rows.push(..._rows);

          await tx
            .withSchema(namespaceInfo.internalNamespace)
            .insertInto(namespaceInfo.internalTableIds[tableName])
            .values(
              createRows.map((row) => ({
                operation: 0,
                id: row.id,
                checkpoint: encodedCheckpoint,
              })),
            )
            .execute();
        }
      });

      return rows.map((row) => decodeRow(row, table, kind));
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
      const encodedId = encodeValue(id, table.id, kind);

      const row = await db.transaction().execute(async (tx) => {
        const latestRow = await tx
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
            ? data({ current: decodeRow(latestRow, table, kind) })
            : data;
        const updateRow = encodeRow({ id, ...updateObject }, table, kind);

        const updateResult = await tx
          .withSchema(namespaceInfo.userNamespace)
          .updateTable(tableName)
          .set(updateRow)
          .where("id", "=", encodedId)
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, ...updateObject });
          });

        await tx
          .withSchema(namespaceInfo.internalNamespace)
          .insertInto(namespaceInfo.internalTableIds[tableName])
          .values({
            operation: 1,
            checkpoint: encodedCheckpoint,
            ...latestRow,
          })
          .execute();

        return updateResult;
      });

      const result = decodeRow(row, table, kind);

      return result;
    });
  },
  updateMany: ({
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

    return db.wrap({ method: `${tableName}.updateMany` }, async () => {
      const rows = await db.transaction().execute(async (tx) => {
        const latestRows = await tx
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where((eb) =>
            buildWhereConditions({
              eb,
              where,
              table,
              encoding: kind,
            }),
          )
          .execute();

        const rows: { [key: string]: any }[] = [];
        for (const latestRow of latestRows) {
          const updateObject =
            typeof data === "function"
              ? data({ current: decodeRow(latestRow, table, kind) })
              : data;

          // Here, `latestRow` is already encoded, so we need to exclude it from `encodeRow`.
          const updateRow = {
            id: latestRow.id,
            ...encodeRow(updateObject, table, kind),
          };

          const row = await tx
            .withSchema(namespaceInfo.userNamespace)
            .updateTable(tableName)
            .set(updateRow)
            .where("id", "=", latestRow.id)
            .returningAll()
            .executeTakeFirstOrThrow()
            .catch((err) => {
              throw parseStoreError(err, updateObject);
            });

          rows.push(row);

          await tx
            .withSchema(namespaceInfo.internalNamespace)
            .insertInto(namespaceInfo.internalTableIds[tableName])
            .values({
              operation: 1,
              checkpoint: encodedCheckpoint,
              ...latestRow,
            })
            .execute();
        }

        return rows;
      });

      return rows.map((row) => decodeRow(row, table, kind));
    });
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
      const encodedId = encodeValue(id, table.id, kind);
      const createRow = encodeRow({ id, ...create }, table, kind);

      const row = await db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();

        // If there is no latest version, insert a new version using the create data.
        if (latestRow === undefined) {
          const row = await tx
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRow)
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
            .insertInto(namespaceInfo.internalTableIds[tableName])
            .values({
              operation: 0,
              id: createRow.id,
              checkpoint: encodedCheckpoint,
            })
            .execute();

          return row;
        }

        const updateObject =
          typeof update === "function"
            ? update({ current: decodeRow(latestRow, table, kind) })
            : update;
        const updateRow = encodeRow({ id, ...updateObject }, table, kind);

        const row = await tx
          .withSchema(namespaceInfo.userNamespace)
          .updateTable(tableName)
          .set(updateRow)
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
          .insertInto(namespaceInfo.internalTableIds[tableName])
          .values({
            operation: 1,
            checkpoint: encodedCheckpoint,
            ...latestRow,
          })
          .execute();

        return row;
      });

      return decodeRow(row, table, kind);
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
      const encodedId = encodeValue(id, table.id, kind);

      const isDeleted = await db.transaction().execute(async (tx) => {
        const row = await tx
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();

        const deletedRow = await tx
          .withSchema(namespaceInfo.userNamespace)
          .deleteFrom(tableName)
          .where("id", "=", encodedId)
          .returning(["id"])
          .executeTakeFirst()
          .catch((err) => {
            throw parseStoreError(err, { id });
          });

        if (row !== undefined) {
          await tx
            .withSchema(namespaceInfo.internalNamespace)
            .insertInto(namespaceInfo.internalTableIds[tableName])
            .values({
              operation: 2,
              checkpoint: encodedCheckpoint,
              ...row,
            })
            .execute();
        }

        return !!deletedRow;
      });

      return isDeleted;
    });
  },
});
