import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import type { Transaction } from "kysely";

export const revertTable = async (
  tx: Transaction<any>,
  tableName: string,
  checkpoint: Checkpoint,
) => {
  const versionedTableName = `${tableName}_versioned`;
  const encodedCheckpoint = encodeCheckpoint(checkpoint);

  // Delete any versions that are newer than or equal to the safe checkpoint.
  await tx
    .deleteFrom(versionedTableName)
    .where("effectiveFromCheckpoint", ">=", encodedCheckpoint)
    .execute();

  // Now, any versions with effectiveToCheckpoint greater than or equal
  // to the safe checkpoint are the new latest version.
  await tx
    .updateTable(versionedTableName)
    .set({ effectiveToCheckpoint: "latest" })
    .where("effectiveToCheckpoint", ">=", encodedCheckpoint)
    .execute();
};
