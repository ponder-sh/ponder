import { StoreError } from "@/common/errors.js";
import { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema } from "@/schema/types.js";
import type { Row, WhereInput, WriteIndexingStore } from "./store.js";
import { decodeRow, encodeRow, encodeValue } from "./utils/encoding.js";
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

      try {
        const row = await db
          .withSchema(namespaceInfo.userNamespace)
          .insertInto(tableName)
          .values(createRow)
          .returningAll()
          .executeTakeFirstOrThrow();

        return decodeRow(row, table, kind);
      } catch (err) {
        const error = err as Error;
        throw (kind === "sqlite" &&
          error.message.includes("UNIQUE constraint failed")) ||
          (kind === "postgres" &&
            error.message.includes("violates unique constraint"))
          ? new StoreError(
              `Cannot create ${tableName} record with ID ${id} because a record already exists with that ID (UNIQUE constraint violation). Hint: Did you forget to await the promise returned by a store method? Or, consider using ${tableName}.upsert().`,
            )
          : error;
      }
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

    return db.wrap({ method: `${tableName}.createMany` }, async () => {
      try {
        const rows: Row[] = [];
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
              .execute();

            rows.push(...(_rows as Row[]));
          }
        });

        return rows.map((row) => decodeRow(row, table, kind));
      } catch (err) {
        const error = err as Error;
        throw (kind === "sqlite" &&
          error.message.includes("UNIQUE constraint failed")) ||
          (kind === "postgres" &&
            error.message.includes("violates unique constraint"))
          ? new StoreError(
              `Cannot createMany ${tableName} records because one or more records already exist (UNIQUE constraint violation). Hint: Did you forget to await the promise returned by a store method?`,
            )
          : error;
      }
    });
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

      let updateRow: ReturnType<typeof encodeRow>;

      if (typeof data === "function") {
        // Find the latest version of this instance.
        const latestRow = await db
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();
        if (!latestRow)
          throw new StoreError(
            `Cannot update ${tableName} record with ID ${id} because no existing record was found with that ID. Consider using ${tableName}.upsert(), or create the record before updating it. Hint: Did you forget to await the promise returned by a store method?`,
          );

        const current = decodeRow(latestRow, table, kind);
        const updateObject = data({ current });
        updateRow = encodeRow({ id, ...updateObject }, table, kind);
      } else {
        updateRow = encodeRow({ id, ...data }, table, kind);
      }
      const row = await db
        .updateTable(tableName)
        .set(updateRow)
        .where("id", "=", encodedId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const result = decodeRow(row, table, kind);

      return result;
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
      let query = db
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

      const rows = await db.transaction().execute((tx) => {
        return Promise.all(
          latestRows.map((latestRow) => {
            // If the user passed an update function, call it with the current instance.
            let updateRow: ReturnType<typeof encodeRow>;
            if (typeof data === "function") {
              const current = decodeRow(latestRow, table, kind);
              const updateObject = data({ current });
              updateRow = encodeRow(updateObject, table, kind);
            } else {
              updateRow = encodeRow(data, table, kind);
            }

            return tx
              .withSchema(namespaceInfo.userNamespace)
              .updateTable(tableName)
              .set(updateRow)
              .where("id", "=", latestRow.id)
              .returningAll()
              .executeTakeFirstOrThrow();
          }),
        );
      });

      return rows.map((row) => decodeRow(row, table, kind));
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
            .executeTakeFirstOrThrow();

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
          .executeTakeFirstOrThrow();
        return decodeRow(row, table, kind);
      } else {
        const updateRow = encodeRow({ id, ...update }, table, kind);

        const row = await db
          .withSchema(namespaceInfo.userNamespace)
          .insertInto(tableName)
          .values(createRow)
          .onConflict((oc) => oc.column("id").doUpdateSet(updateRow))
          .returningAll()
          .executeTakeFirstOrThrow();

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
        .executeTakeFirst();

      return !!deletedRow;
    });
  },
});
