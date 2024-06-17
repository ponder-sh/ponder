import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import type { HeadlessKysely } from "./kysely.js";
import type { NamespaceInfo } from "./service.js";

export const revertIndexingTables = async ({
  checkpoint,
  namespaceInfo,
  db,
}: {
  namespaceInfo: NamespaceInfo;
  db: HeadlessKysely<any>;
  checkpoint: Checkpoint;
}) => {
  await db.wrap({ method: "revert" }, async () => {
    const encodedCheckpoint = encodeCheckpoint(checkpoint);

    await Promise.all(
      Object.entries(namespaceInfo.internalTableIds).map(
        async ([tableName, tableId]) => {
          await db.transaction().execute(async (tx) => {
            const rows = await tx
              .withSchema(namespaceInfo.internalNamespace)
              .deleteFrom(tableId)
              .returningAll()
              .where("checkpoint", ">", encodedCheckpoint)
              .execute();

            const reversed = rows.sort(
              (a, b) => b.operation_id - a.operation_id,
            );

            // undo operation
            for (const log of reversed) {
              if (log.operation === 0) {
                // create
                await tx
                  .withSchema(namespaceInfo.userNamespace)
                  .deleteFrom(tableName)
                  .where("id", "=", log.id)
                  .execute();
              } else if (log.operation === 1) {
                // update
                log.operation_id = undefined;
                log.checkpoint = undefined;
                log.operation = undefined;

                await tx
                  .withSchema(namespaceInfo.userNamespace)
                  .updateTable(tableName)
                  .set(log)
                  .where("id", "=", log.id)
                  .execute();
              } else {
                // delete
                log.operation_id = undefined;
                log.checkpoint = undefined;
                log.operation = undefined;

                await tx
                  .withSchema(namespaceInfo.userNamespace)
                  .insertInto(tableName)
                  .values(log)
                  .execute();
              }
            }
          });
        },
      ),
    );
  });
};
