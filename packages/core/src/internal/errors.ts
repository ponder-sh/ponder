import {
  ESBuildBuildError,
  ESBuildContextError,
  ESBuildTransformError,
} from "@/build/stacktrace.js";
import type { getLogsRetryHelper } from "@ponder/utils";

/** Base class for all known errors. */
export class BaseError<
  cause extends Error | undefined = undefined,
> extends Error {
  override name = "BaseError";
  override cause: cause;

  meta: string[] = [];

  constructor(message?: string | undefined, { cause }: { cause?: cause } = {}) {
    super(message, { cause });
    this.cause = cause as cause;
    Object.setPrototypeOf(this, BaseError.prototype);
  }
}

export class ShutdownError extends BaseError {
  override name = "ShutdownError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, ShutdownError.prototype);
  }
}

export class BuildError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "BuildError";

  constructor(message?: string | undefined, { cause }: { cause?: cause } = {}) {
    super(message, { cause });
    Object.setPrototypeOf(this, BuildError.prototype);
  }
}

export class RpcRequestError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "RpcRequestError";

  constructor(message?: string | undefined, { cause }: { cause?: cause } = {}) {
    super(message, { cause });
    Object.setPrototypeOf(this, RpcRequestError.prototype);
  }
}

export class EthGetLogsRangeError extends BaseError<
  RpcRequestError<Error | undefined>
> {
  override name = "EthGetLogsRangeError";
  override cause: RpcRequestError<Error | undefined>;
  isSuggestedRange: Extract<
    ReturnType<typeof getLogsRetryHelper>,
    { shouldRetry: true }
  >["isSuggestedRange"];
  ranges: Extract<
    ReturnType<typeof getLogsRetryHelper>,
    { shouldRetry: true }
  >["ranges"];

  constructor(
    { cause }: { cause: RpcRequestError<Error | undefined> },
    params: Extract<
      ReturnType<typeof getLogsRetryHelper>,
      { shouldRetry: true }
    >,
  ) {
    super(undefined, { cause });
    this.cause = cause;
    this.isSuggestedRange = params.isSuggestedRange;
    this.ranges = params.ranges;
    Object.setPrototypeOf(this, EthGetLogsRangeError.prototype);
  }
}

export class QueryBuilderError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "QueryBuilderError";

  constructor({ cause }: { cause?: cause } = {}) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, QueryBuilderError.prototype);
  }
}

/**
 * Error caused by an individual `qb.wrap` statement inside
 * of a `qb.transaction` callback.
 */
export class TransactionStatementError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "TransactionStatementError";

  constructor({ cause }: { cause?: cause } = {}) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, TransactionStatementError.prototype);
  }
}

/**
 * Error thrown from a `qb.transaction` callback not caused by a `qb.wrap` statement.
 */
export class TransactionCallbackError<
  cause extends Error,
> extends BaseError<cause> {
  override name = "TransactionCallbackError";

  constructor({ cause }: { cause: cause }) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, TransactionCallbackError.prototype);
  }
}

export class CopyFlushError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "CopyFlushError";

  constructor({ cause }: { cause?: cause } = {}) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, CopyFlushError.prototype);
  }
}

export class DelayedInsertError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "DelayedInsertError";

  constructor({ cause }: { cause?: cause } = {}) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, DelayedInsertError.prototype);
  }
}

export class IndexingDBError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "IndexingDBError";

  constructor(message?: string | undefined, { cause }: { cause?: cause } = {}) {
    super(message, { cause });
    Object.setPrototypeOf(this, IndexingDBError.prototype);
  }
}

export class RawSqlError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "RawSqlError";

  constructor({ cause }: { cause?: cause } = {}) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, RawSqlError.prototype);
  }
}

export class BigIntSerializationError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "BigIntSerializationError";

  constructor({ cause }: { cause?: cause } = {}) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, BigIntSerializationError.prototype);
  }
}

/**
 * @dev `stack` property points to the user code that caused the error.
 */
export class ServerError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "ServerError";

  constructor({ cause }: { cause?: cause } = {}) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, ServerError.prototype);
  }
}

/**
 * @dev `stack` property points to the user code that caused the error.
 */
export class IndexingFunctionError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "IndexingFunctionError";

  constructor({ cause }: { cause?: cause } = {}) {
    super(undefined, { cause });
    Object.setPrototypeOf(this, IndexingFunctionError.prototype);
  }
}

/**
 * Error throw when an `event` property is unexpectedly accessed in an indexing function.
 */
export class InvalidEventAccessError extends BaseError {
  override name = "InvalidEventAccessError";
  key: string;

  constructor(key: string) {
    super();
    this.key = key;
    Object.setPrototypeOf(this, InvalidEventAccessError.prototype);
  }
}

export class MigrationError<
  cause extends Error | undefined = undefined,
> extends BaseError<cause> {
  override name = "MigrationError";
  // TODO(kyle) exit code

  constructor(message?: string | undefined, { cause }: { cause?: cause } = {}) {
    super(message, { cause });
    Object.setPrototypeOf(this, MigrationError.prototype);
  }
}

// export const nonRetryableUserErrorNames = [
//   ShutdownError,
//   BuildError,
//   MigrationError,
//   UniqueConstraintError,
//   NotNullConstraintError,
//   InvalidStoreAccessError,
//   RecordNotFoundError,
//   CheckConstraintError,
//   InvalidStoreMethodError,
//   UndefinedTableError,
//   BigIntSerializationError,
//   DelayedInsertError,
//   RawSqlError,
//   IndexingFunctionError,
// ].map((err) => err.name);

/**
 * Returns true if the error is derived from a logical error in user code.
 */
export function isUserDerivedError(error: BaseError): boolean {
  if (error instanceof BuildError) return true;
  if (error instanceof IndexingDBError) return true;
  if (error instanceof DelayedInsertError) return true;
  if (
    error instanceof IndexingFunctionError &&
    error.cause instanceof BaseError === false
  ) {
    return true;
  }

  if (error instanceof BaseError && error.cause) {
    if (isUserDerivedError(error.cause)) return true;
  }
  return false;
}

export function stripErrorStack(error: Error): void {
  if (shouldPrintErrorStack(error) === false) {
    error.stack = undefined;
  }
  if (error instanceof BaseError && error.cause) {
    stripErrorStack(error.cause);
  }
}

export function shouldPrintErrorStack(error: Error): boolean {
  if (error instanceof ServerError) return true;
  if (error instanceof IndexingFunctionError) return true;
  if (error instanceof ESBuildTransformError) return true;
  if (error instanceof ESBuildBuildError) return true;
  if (error instanceof ESBuildContextError) return true;
  return false;
}
