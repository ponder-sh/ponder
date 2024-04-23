import { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema } from "@/schema/types.js";
import { sql } from "kysely";
import type { Row, WhereInput, WriteIndexingStore } from "./store.js";
import { decodeRow, encodeRow, encodeValue } from "./utils/encoding.js";
import { parseStoreError } from "./utils/errors.js";
import { buildWhereConditions } from "./utils/filter.js";

const MAX_BATCH_SIZE = 1_000 as const;

export const getHistoricalIndexingStore = ({
  kind,
  schema,
  namespaceInfo,
  db,
}: {
  kind: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
}): WriteIndexingStore<"historical"> => ({
  create: async ({
    tableName,
    id,
    data = {},
  }: {
    tableName: string;
    id: string | number | bigint;
    data?: Omit<Row, "id">;
  }) => {
    const table = schema.tables[tableName];

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
    data: Row[];
  }) => {
    const table = schema.tables[tableName];

    const rows: Row[] = [];

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

        rows.push(...(_rows as Row[]));
      });
    }

    return rows;
  },
  update: async ({
    tableName,
    id,
    data = {},
  }: {
    tableName: string;
    id: string | number | bigint;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = schema.tables[tableName];

    return db.wrap({ method: `${tableName}.update` }, async () => {
      const encodedId = encodeValue(id, table.id, kind);

      let updateObject: Partial<Omit<Row, "id">>;

      if (typeof data === "function") {
        // Find the latest version of this instance.
        const latestRow = await db
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirstOrThrow()
          .catch((err) => {
            throw parseStoreError(err, { id, data: "(function)" });
          });

        const current = decodeRow(latestRow, table, kind);
        updateObject = data({ current });
      } else {
        updateObject = data;
      }

      const updateRow = encodeRow({ id, ...updateObject }, table, kind);
      const row = await db
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
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = schema.tables[tableName];

    return db.wrap({ method: `${tableName}.updateMany` }, async () => {
      if (typeof data === "function") {
        const rows = await db.transaction().execute(async (tx) => {
          let query = tx
            .withSchema(namespaceInfo.userNamespace)
            .selectFrom(tableName)
            .selectAll();

          if (where) {
            query = query.where((eb) =>
              buildWhereConditions({
                eb,
                where,
                table,
                encoding: kind,
              }),
            );
          }

          const latestRows = await query.execute();
          const rows: Row[] = [];
          for (const latestRow of latestRows) {
            const current = decodeRow(latestRow, table, kind);
            const updateObject = data({ current });
            const updateRow = encodeRow(updateObject, table, kind);

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
            rows.push(row as Row);
          }

          return rows;
        });

        return rows.map((row) => decodeRow(row, table, kind));
      } else {
        const updateRow = encodeRow(data, table, kind);

        const rows = await db
          .with("latestRows(id)", (db) => {
            let query = db
              .withSchema(namespaceInfo.userNamespace)
              .selectFrom(tableName)
              .select("id");

            if (where) {
              query = query.where((eb) =>
                buildWhereConditions({
                  eb,
                  where,
                  table,
                  encoding: kind,
                }),
              );
            }
            return query;
          })
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
    id: string | number | bigint;
    create?: Omit<Row, "id">;
    update?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = schema.tables[tableName];

    return db.wrap({ method: `${tableName}.upsert` }, async () => {
      const encodedId = encodeValue(id, table.id, kind);
      const createRow = encodeRow({ id, ...create }, table, kind);

      if (typeof update === "function") {
        // Find the latest version of this instance.
        const latestRow = await db
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();

        // If there is no latest version, insert a new version using the create data.
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
    id: string | number | bigint;
  }) => {
    const table = schema.tables[tableName];

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
