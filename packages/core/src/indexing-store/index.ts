import {
  BigIntSerializationError,
  CheckConstraintError,
  NotNullConstraintError,
  UniqueConstraintError,
  getBaseError,
} from "@/common/errors.js";
import type { Schema } from "@/drizzle/index.js";
import type { Db } from "@/types/db.js";

export type IndexingStore<policy extends "historical" | "realtime"> =
  policy extends "realtime"
    ? Db<Schema>
    : Db<Schema> & {
        /** Persist the cache to the database. */
        flush: () => Promise<void>;
        /** Return `true` if the cache size in bytes is above the limit specified by `option.indexingCacheMaxBytes`. */
        isCacheFull: () => boolean;
      };

export const parseSqlError = (e: any): Error => {
  let error = getBaseError(e);

  if (error?.message?.includes("violates not-null constraint")) {
    error = new NotNullConstraintError(error.message);
  } else if (error?.message?.includes("violates unique constraint")) {
    error = new UniqueConstraintError(error.message);
  } else if (error?.message.includes("violates check constraint")) {
    error = new CheckConstraintError(error.message);
  } else if (
    error?.message?.includes("Do not know how to serialize a BigInt")
  ) {
    error = new BigIntSerializationError(error.message);
    error.meta.push(
      "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/utilities/replace-bigints",
    );
  }

  return error;
};
