import { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema, Table } from "@/schema/common.js";
import type { DatabaseRecord, UserId, UserRecord } from "@/types/schema.js";
import { sql } from "kysely";
import type { WhereInput, WriteStore } from "./store.js";
import { decodeRow, encodeRow, encodeValue } from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";
import { buildWhereConditions } from "./utils/filter.js";

const MAX_BATCH_SIZE = 1_000 as const;

export const getHistoricalStore = ({
  kind,
  schema,
  namespaceInfo,
  db,
}: {
  kind: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
}): WriteStore<"historical"> => ({
  create: async ({
    tableName,
    id,
    data = {},
  }: {
    tableName: string;
    id: UserId;
    data?: Omit<UserRecord, "id">;
  }) => {
    const table = schema[tableName] as Table;

    return db.wrap({ method: `${tableName}.create` }, async () => {
      const createRow = encodeRow({ id, ...data }, table, kind);

      const row = await db
        .withSchema(namespaceInfo.userNamespace)
        .insertInto(tableName)
        .values(createRow)
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((err) => {
          throw parseStoreError(err, { id, ...data });
        });

      return decodeRow(row, table, kind);
    });
  },
  createMany: async ({
    tableName,
    data,
  }: {
    tableName: string;
    data: UserRecord[];
  }) => {
    const table = schema[tableName] as Table;

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
    const table = schema[tableName] as Table;

    return db.wrap({ method: `${tableName}.update` }, async () => {
      const encodedId = encodeValue(id, table.id, kind);

      let updateObject: Partial<Omit<UserRecord, "id">>;
      if (typeof data === "function") {
        const latestRow = await db
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, data: "(function)" });
          });

        updateObject = data({ current: decodeRow(latestRow, table, kind) });
      } else {
        updateObject = data;
      }
      const updateRow = encodeRow({ id, ...updateObject }, table, kind);

      const row = await db
        .withSchema(namespaceInfo.userNamespace)
        .updateTable(tableName)
        .set(updateRow)
        .where("id", "=", encodedId)
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((err) => {
          throw parseStoreError(err, { id, ...updateObject });
        });

      return decodeRow(row, table, kind);
    });
  },
  updateMany: async ({
    tableName,
    where,
    data = {},
  }: {
    tableName: string;
    where: WhereInput<any>;
    data?:
      | Partial<Omit<UserRecord, "id">>
      | ((args: { current: UserRecord }) => Partial<Omit<UserRecord, "id">>);
  }) => {
    const table = schema[tableName] as Table;

    return db.wrap({ method: `${tableName}.updateMany` }, async () => {
      if (typeof data === "function") {
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

          const rows: { [x: string]: any }[] = [];
          for (const latestRow of latestRows) {
            const current = decodeRow(latestRow, table, kind);
            const updateObject = data({ current });
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
          }

          return rows;
        });

        return rows.map((row) => decodeRow(row, table, kind));
      } else {
        const updateRow = encodeRow(data, table, kind);

        const rows = await db
          .with("latestRows(id)", (db) =>
            db
              .withSchema(namespaceInfo.userNamespace)
              .selectFrom(tableName)
              .select("id")
              .where((eb) =>
                buildWhereConditions({
                  eb,
                  where,
                  table,
                  encoding: kind,
                }),
              ),
          )
          .withSchema(namespaceInfo.userNamespace)
          .updateTable(tableName)
          .set(updateRow)
          .from("latestRows")
          .where(`${tableName}.id`, "=", sql.ref("latestRows.id"))
          .returningAll()
          .execute()
          .catch((err) => {
            throw parseStoreError(err, data);
          });

        return rows.map((row) => decodeRow(row, table, kind));
      }
    });
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
    const table = schema[tableName] as Table;

    return db.wrap({ method: `${tableName}.upsert` }, async () => {
      const encodedId = encodeValue(id, table.id, kind);
      const createRow = encodeRow({ id, ...create }, table, kind);

      if (typeof update === "function") {
        const latestRow = await db
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();

        if (latestRow === undefined) {
          const row = await db
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRow)
            .returningAll()
            .executeTakeFirstOrThrow()
            .catch((err) => {
              const prettyObject: any = { id };
              for (const [key, value] of Object.entries(create))
                prettyObject[`create.${key}`] = value;
              prettyObject.update = "(function)";
              throw parseStoreError(err, prettyObject);
            });

          return decodeRow(row, table, kind);
        }

        const current = decodeRow(latestRow, table, kind);
        const updateObject = update({ current });
        const updateRow = encodeRow({ id, ...updateObject }, table, kind);

        const row = await db
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

        return decodeRow(row, table, kind);
      } else {
        const updateRow = encodeRow({ id, ...update }, table, kind);

        const row = await db
          .withSchema(namespaceInfo.userNamespace)
          .insertInto(tableName)
          .values(createRow)
          .onConflict((oc) => oc.column("id").doUpdateSet(updateRow))
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((err) => {
            const prettyObject: any = { id };
            for (const [key, value] of Object.entries(create))
              prettyObject[`create.${key}`] = value;
            for (const [key, value] of Object.entries(update))
              prettyObject[`update.${key}`] = value;
            throw parseStoreError(err, prettyObject);
          });

        return decodeRow(row, table, kind);
      }
    });
  },
  delete: async ({
    tableName,
    id,
  }: {
    tableName: string;
    id: UserId;
  }) => {
    const table = schema[tableName] as Table;

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
});
