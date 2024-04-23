import {
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
  }

  error.meta.push(`Store method arguments:\n${prettyPrint(args)}`);

  return error;
}
