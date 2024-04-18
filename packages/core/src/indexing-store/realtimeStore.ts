import { StoreError } from "@/common/errors.js";
import type { HeadlessKysely } from "@/database/kysely.js";
import type { NamespaceInfo } from "@/database/service.js";
import type { Schema } from "@/schema/types.js";
import type { Row, WhereInput, WriteIndexingStore } from "./store.js";
import { decodeRow, encodeRow, encodeValue } from "./utils/encoding.js";
import { buildWhereConditions } from "./utils/filter.js";

const MAX_BATCH_SIZE = 1_000 as const;

export const getRealtimeIndexingStore = ({
  kind,
  schema,
  namespaceInfo,
  db,
}: {
  kind: "sqlite" | "postgres";
  schema: Schema;
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
}): WriteIndexingStore<"realtime"> => ({
  create: ({
    tableName,
    encodedCheckpoint,
    id,
    data = {},
  }: {
    tableName: string;
    encodedCheckpoint: string;
    id: string | number | bigint;
    data?: Omit<Row, "id">;
  }) => {
    const table = schema.tables[tableName];

    return db.wrap({ method: `${tableName}.create` }, async () => {
      const createRow = encodeRow({ id, ...data }, table, kind);

      try {
        return await db.transaction().execute(async (tx) => {
          const row = await tx
            .withSchema(namespaceInfo.userNamespace)
            .insertInto(tableName)
            .values(createRow)
            .returningAll()
            .executeTakeFirstOrThrow();

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
  createMany: ({
    tableName,
    encodedCheckpoint,
    data,
  }: {
    tableName: string;
    encodedCheckpoint: string;
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
  update: ({
    tableName,
    encodedCheckpoint,
    id,
    data = {},
  }: {
    tableName: string;
    encodedCheckpoint: string;
    id: string | number | bigint;
    data?:
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = schema.tables[tableName];

    return db.wrap({ method: `${tableName}.update` }, async () => {
      const encodedId = encodeValue(id, table.id, kind);

      const row = await db.transaction().execute(async (tx) => {
        // Find the latest version of this instance.
        const latestRow = await tx
          .withSchema(namespaceInfo.userNamespace)
          .selectFrom(tableName)
          .selectAll()
          .where("id", "=", encodedId)
          .executeTakeFirst();
        if (!latestRow)
          throw new StoreError(
            `Cannot update ${tableName} record with ID ${id} because no existing record was found with that ID. Consider using ${tableName}.upsert(), or create the record before updating it. Hint: Did you forget to await the promise returned by a store method?`,
          );

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof encodeRow>;
        if (typeof data === "function") {
          const current = decodeRow(latestRow, table, kind);
          const updateObject = data({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, kind);
        } else {
          updateRow = encodeRow({ id, ...data }, table, kind);
        }

        const updateResult = await tx
          .withSchema(namespaceInfo.userNamespace)
          .updateTable(tableName)
          .set(updateRow)
          .where("id", "=", encodedId)
          .returningAll()
          .executeTakeFirstOrThrow();

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
      | Partial<Omit<Row, "id">>
      | ((args: { current: Row }) => Partial<Omit<Row, "id">>);
  }) => {
    const table = schema.tables[tableName];

    return db.wrap({ method: `${tableName}.updateMany` }, async () => {
      const rows = await db.transaction().execute(async (tx) => {
        // TODO(kyle) can remove this from the tx

        // Get all IDs that match the filter.
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
          // If the user passed an update function, call it with the current instance.
          let updateRow: ReturnType<typeof encodeRow>;
          if (typeof data === "function") {
            const current = decodeRow(latestRow, table, kind);
            const updateObject = data({ current });
            updateRow = encodeRow(updateObject, table, kind);
          } else {
            updateRow = encodeRow(data, table, kind);
          }

          const row = await tx
            .withSchema(namespaceInfo.userNamespace)
            .updateTable(tableName)
            .set(updateRow)
            .where("id", "=", latestRow.id)
            .returningAll()
            .executeTakeFirstOrThrow();

          rows.push(row as Row);

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
            .executeTakeFirstOrThrow();

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

        // If the user passed an update function, call it with the current instance.
        let updateRow: ReturnType<typeof encodeRow>;
        if (typeof update === "function") {
          const current = decodeRow(latestRow, table, kind);
          const updateObject = update({ current });
          updateRow = encodeRow({ id, ...updateObject }, table, kind);
        } else {
          updateRow = encodeRow({ id, ...update }, table, kind);
        }

        const row = await tx
          .withSchema(namespaceInfo.userNamespace)
          .updateTable(tableName)
          .set(updateRow)
          .where("id", "=", encodedId)
          .returningAll()
          .executeTakeFirstOrThrow();

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
    id: string | number | bigint;
  }) => {
    const table = schema.tables[tableName];

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
          .executeTakeFirst();

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

// export class RealtimeIndexingStore  {
//   kind: "sqlite" | "postgres";
//   private namespaceInfo: NamespaceInfo;

//   db: HeadlessKysely<any>;
//   schema: Schema;

//   constructor({
//     kind,
//     schema,
//     namespaceInfo,
//     db,
//   }: {
//     kind: "sqlite" | "postgres";
//     schema: Schema;
//     namespaceInfo: NamespaceInfo;
//     db: HeadlessKysely<any>;
//   }) {
//     this.kind = kind;
//     this.schema = schema;
//     this.namespaceInfo = namespaceInfo;
//     this.db = db;
//   }

//   async revert({
//     checkpoint,
//     isCheckpointSafe,
//   }: { checkpoint: Checkpoint; isCheckpointSafe: boolean }) {
//     await this.db.wrap({ method: "revert" }, async () => {
//       const encodedCheckpoint = encodeCheckpoint(checkpoint);

//       await Promise.all(
//         Object.entries(this.namespaceInfo.internalTableIds).map(
//           async ([tableName, tableId]) => {
//             await this.db.transaction().execute(async (tx) => {
//               const rows = await tx
//                 .withSchema(this.namespaceInfo.internalNamespace)
//                 .deleteFrom(tableId)
//                 .returningAll()
//                 .where(
//                   "checkpoint",
//                   isCheckpointSafe ? ">" : ">=",
//                   encodedCheckpoint,
//                 )
//                 .execute();

//               const reversed = rows.sort(
//                 (a, b) => b.operation_id - a.operation_id,
//               );

//               // undo operation
//               for (const log of reversed) {
//                 if (log.operation === 0) {
//                   // create
//                   await tx
//                     .withSchema(this.namespaceInfo.userNamespace)
//                     .deleteFrom(tableName)
//                     .where("id", "=", log.id)
//                     .execute();
//                 } else if (log.operation === 1) {
//                   // update
//                   log.operation_id = undefined;
//                   log.checkpoint = undefined;
//                   log.operation = undefined;

//                   await tx
//                     .withSchema(this.namespaceInfo.userNamespace)
//                     .updateTable(tableName)
//                     .set(log)
//                     .where("id", "=", log.id)
//                     .execute();
//                 } else {
//                   // delete
//                   log.operation_id = undefined;
//                   log.checkpoint = undefined;
//                   log.operation = undefined;

//                   await tx
//                     .withSchema(this.namespaceInfo.userNamespace)
//                     .insertInto(tableName)
//                     .values(log)
//                     .execute();
//                 }
//               }
//             });
//           },
//         ),
//       );
//     });
//   }

// }
