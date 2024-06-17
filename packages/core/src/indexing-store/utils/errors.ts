import {
  BigIntSerializationError,
  CheckConstraintError,
  NotNullConstraintError,
  RecordNotFoundError,
  UniqueConstraintError,
  getBaseError,
} from "@/common/errors.js";
import { prettyPrint } from "@/utils/print.js";

export function parseStoreError(err: unknown, args: Record<string, unknown>) {
  let error = getBaseError(err);

  if (error.message?.includes("no result")) {
    error = new RecordNotFoundError(
      "No existing record was found with the specified ID",
    );
  } else if (
    error.message?.includes("UNIQUE constraint failed") ||
    error.message?.includes("violates unique constraint")
  ) {
    error = new UniqueConstraintError(error.message);
    error.meta.push(
      "Hints:\n  Did you forget to await the promise returned by a store method?\n  Did you mean to do an upsert?",
    );
  } else if (
    error.message?.includes("NOT NULL constraint failed") ||
    error.message?.includes("violates not-null constraint")
  ) {
    error = new NotNullConstraintError(error.message);
  } else if (
    error.message?.includes("CHECK constraint failed") ||
    error.message?.includes("violates check constraint")
  ) {
    error = new CheckConstraintError(error.message);
  } else if (error.message?.includes("Do not know how to serialize a BigInt")) {
    error = new BigIntSerializationError(error.message);
    error.meta.push(
      "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/utilities/replace-bigints",
    );
  }

  error.meta.push(`Store method arguments:\n${prettyPrint(args)}`);

  return error;
}
