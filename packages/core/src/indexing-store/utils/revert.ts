import { type Checkpoint, encodeCheckpoint } from "@/utils/checkpoint.js";
import type { Kysely } from "kysely";

export const revertTable = async (
  kysely: Kysely<any>,
  tableName: string,
  checkpoint: Checkpoint,
) => {
  const encodedCheckpoint = encodeCheckpoint(checkpoint);

  // Delete any versions that are newer than or equal to the safe checkpoint.
  await kysely
    .deleteFrom(tableName)
    .where("effective_from", ">=", encodedCheckpoint)
    .execute();

  // Now, any versions with effective_to greater than or equal
  // to the safe checkpoint are the new latest version.
  await kysely
    .updateTable(tableName)
    .set({ effective_to: "latest" })
    .where("effective_to", ">=", encodedCheckpoint)
    .execute();
};
