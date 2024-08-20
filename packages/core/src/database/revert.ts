import type { Schema } from "@/schema/common.js";
import { getTables } from "@/schema/utils.js";
import type { HeadlessKysely } from "./kysely.js";

export const revertIndexingTables = async ({
  checkpoint,
  db,
  schema,
}: {
  checkpoint: string;
  db: HeadlessKysely<any>;
  schema: Schema;
}) => {
  await db.wrap({ method: "revert" }, async () => {
    await Promise.all(
      Object.keys(getTables(schema)).map(async (tableName) => {
        await db.transaction().execute(async (tx) => {
          const rows = await tx
            .deleteFrom(`_ponder_reorg_${tableName}`)
            .returningAll()
            .where("checkpoint", ">", checkpoint)
            .execute();

          const reversed = rows.sort((a, b) => b.operation_id - a.operation_id);

          // undo operation
          for (const log of reversed) {
            if (log.operation === 0) {
              // create
              await tx.deleteFrom(tableName).where("id", "=", log.id).execute();
            } else if (log.operation === 1) {
              // update
              log.operation_id = undefined;
              log.checkpoint = undefined;
              log.operation = undefined;

              await tx
                .updateTable(tableName)
                .set(log)
                .where("id", "=", log.id)
                .execute();
            } else {
              // delete
              log.operation_id = undefined;
              log.checkpoint = undefined;
              log.operation = undefined;

              await tx.insertInto(tableName).values(log).execute();
            }
          }
        });
      }),
    );
  });
};
