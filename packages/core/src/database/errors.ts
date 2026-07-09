import {
  BaseError,
  BigIntSerializationError,
  CheckConstraintError,
  DbConnectionError,
  NonRetryableUserError,
  NotNullConstraintError,
  RawSqlError,
  UniqueConstraintError,
  getErrorCauseByInstance,
} from "@/internal/errors.js";

const getErrorCause = (error: unknown) => {
  return error instanceof Error ? error : undefined;
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  return String(error);
};

const getErrorCode = (error: unknown) => {
  if (typeof error === "object" && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }

  return undefined;
};

const getErrorCauseChain = (error: unknown) => {
  const errors: unknown[] = [];
  const seen = new Set<object>();
  let current = error;

  while (current !== undefined && current !== null) {
    errors.push(current);

    if (typeof current !== "object") break;
    if (seen.has(current)) break;
    seen.add(current);

    current = (current as { cause?: unknown }).cause;
  }

  return errors;
};

const isDrizzleQueryError = (error: unknown) => {
  return getErrorMessage(error).startsWith("Failed query:");
};

const getDbError = (error: unknown) => {
  const errors = getErrorCauseChain(error);

  return (
    errors.find((error) => getErrorCode(error) !== undefined) ??
    errors.find((error) => isDrizzleQueryError(error) === false) ??
    error
  );
};

export const getDiagnosticErrorMessage = (error: unknown) => {
  return getErrorCauseChain(error)
    .map(getErrorMessage)
    .filter((message) => message.length > 0)
    .join("\n");
};

export const getPublicErrorMessage = (error: unknown) => {
  const dbError = getDbError(error);

  if (dbError !== error) return getErrorMessage(dbError);
  if (isDrizzleQueryError(error)) return "Database query failed";

  return getErrorMessage(error);
};

export const parseDbError = (error: unknown): Error => {
  const stack = error instanceof Error ? error.stack : undefined;
  const baseError = getErrorCauseByInstance(error, BaseError);
  if (baseError !== undefined) return baseError;

  const cause = getErrorCause(error);
  const message = getDiagnosticErrorMessage(error);
  const dbError = getDbError(error);
  const dbCode = getErrorCode(dbError);
  const dbMessage = getErrorMessage(dbError);

  let parsedError = error instanceof Error ? error : new Error(String(error));

  if (
    dbCode === "23502" ||
    dbMessage.includes("violates not-null constraint")
  ) {
    parsedError = new NotNullConstraintError(message, { cause });
  } else if (
    dbCode === "23505" ||
    dbMessage.includes("violates unique constraint")
  ) {
    parsedError = new UniqueConstraintError(message, { cause });
  } else if (
    dbCode === "23514" ||
    dbMessage.includes("violates check constraint")
  ) {
    parsedError = new CheckConstraintError(message, { cause });
  } else if (
    // nodejs error message
    dbMessage.includes("Do not know how to serialize a BigInt") ||
    // bun error message
    dbMessage.includes("cannot serialize BigInt")
  ) {
    const bigIntError = new BigIntSerializationError(message, { cause });
    bigIntError.meta.push(
      "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/api-reference/ponder-utils#replacebigints",
    );
    parsedError = bigIntError;
  } else if (dbCode === "42P01" || dbMessage.includes("does not exist")) {
    parsedError = new NonRetryableUserError(message, { cause });
  } else if (dbCode === "42710" || dbMessage.includes("already exists")) {
    parsedError = new NonRetryableUserError(message, { cause });
  } else if (
    dbMessage.includes("terminating connection due to administrator command") ||
    dbMessage.includes("connection to client lost") ||
    dbMessage.includes("too many clients already") ||
    dbMessage.includes("Connection terminated unexpectedly") ||
    dbMessage.includes("ECONNRESET") ||
    dbMessage.includes("ETIMEDOUT") ||
    dbMessage.includes("timeout exceeded when trying to connect")
  ) {
    parsedError = new DbConnectionError(message, { cause });
  }

  parsedError.stack = stack;

  return parsedError;
};

const parseRawSqlWrappedError = (error: unknown) => {
  const baseError = getErrorCauseByInstance(error, BaseError);
  if (baseError !== undefined) return baseError;

  const parsedError = parseDbError(error);
  if (parsedError instanceof DbConnectionError) return parsedError;

  return new RawSqlError(getPublicErrorMessage(error), {
    cause: parsedError,
  });
};

const wrapPreparedQueryMethod = (query: unknown, method: "execute" | "all") => {
  const queryWithMethods = query as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  if (typeof queryWithMethods[method] !== "function") return;

  const execute = queryWithMethods[method].bind(query);
  queryWithMethods[method] = async (...args: unknown[]) => {
    try {
      return await execute(...args);
    } catch (error) {
      throw parseRawSqlWrappedError(error);
    }
  };
};

export const wrapDrizzleQueryErrorBoundary = <TDatabase>(db: TDatabase) => {
  const session = (db as any)._.session;
  const prepareQuery = session.prepareQuery.bind(session);

  session.prepareQuery = (...args: unknown[]) => {
    const query = prepareQuery(...args);
    wrapPreparedQueryMethod(query, "execute");
    wrapPreparedQueryMethod(query, "all");
    return query;
  };

  return db;
};
