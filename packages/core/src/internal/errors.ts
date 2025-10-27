/** Base class for all known errors. */
export class BaseError extends Error {
  override name = "BaseError";

  meta: string[] = [];

  constructor(message?: string | undefined, { cause }: { cause?: Error } = {}) {
    super(message, { cause });
    Object.setPrototypeOf(this, BaseError.prototype);
  }
}

/** Error caused by user code. Should not be retried. */
export class NonRetryableUserError extends BaseError {
  override name = "NonRetryableUserError";

  constructor(message?: string | undefined, { cause }: { cause?: Error } = {}) {
    super(message, { cause });
    Object.setPrototypeOf(this, NonRetryableUserError.prototype);
  }
}

/** Error that may succeed if tried again. */
export class RetryableError extends BaseError {
  override name = "RetryableError";

  constructor(message?: string | undefined, { cause }: { cause?: Error } = {}) {
    super(message, { cause });
    Object.setPrototypeOf(this, RetryableError.prototype);
  }
}

export class ShutdownError extends NonRetryableUserError {
  override name = "ShutdownError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, ShutdownError.prototype);
  }
}

export class BuildError extends NonRetryableUserError {
  override name = "BuildError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, BuildError.prototype);
  }
}

export class MigrationError extends NonRetryableUserError {
  override name = "MigrationError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, MigrationError.prototype);
  }
}

// Non-retryable database errors

export class UniqueConstraintError extends NonRetryableUserError {
  override name = "UniqueConstraintError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, UniqueConstraintError.prototype);
  }
}

export class NotNullConstraintError extends NonRetryableUserError {
  override name = "NotNullConstraintError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, NotNullConstraintError.prototype);
  }
}

export class InvalidStoreAccessError extends NonRetryableUserError {
  override name = "InvalidStoreAccessError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, InvalidStoreAccessError.prototype);
  }
}

export class RecordNotFoundError extends NonRetryableUserError {
  override name = "RecordNotFoundError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, RecordNotFoundError.prototype);
  }
}

export class CheckConstraintError extends NonRetryableUserError {
  override name = "CheckConstraintError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, CheckConstraintError.prototype);
  }
}

// Retryable database errors

export class DbConnectionError extends RetryableError {
  override name = "DbConnectionError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, DbConnectionError.prototype);
  }
}

export class TransactionStatementError extends RetryableError {
  override name = "TransactionStatementError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, TransactionStatementError.prototype);
  }
}

export class CopyFlushError extends RetryableError {
  override name = "CopyFlushError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, CopyFlushError.prototype);
  }
}

export class InvalidEventAccessError extends RetryableError {
  override name = "InvalidEventAccessError";
  key: string;

  constructor(key: string, message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, InvalidEventAccessError.prototype);

    this.key = key;
  }
}

// Non-retryable indexing store errors

export class InvalidStoreMethodError extends NonRetryableUserError {
  override name = "InvalidStoreMethodError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, InvalidStoreMethodError.prototype);
  }
}

export class UndefinedTableError extends NonRetryableUserError {
  override name = "UndefinedTableError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, UndefinedTableError.prototype);
  }
}

export class BigIntSerializationError extends NonRetryableUserError {
  override name = "BigIntSerializationError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, BigIntSerializationError.prototype);
  }
}

export class DelayedInsertError extends NonRetryableUserError {
  override name = "DelayedInsertError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, DelayedInsertError.prototype);
  }
}

export class RawSqlError extends NonRetryableUserError {
  override name = "RawSqlError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, RawSqlError.prototype);
  }
}

export class IndexingFunctionError extends NonRetryableUserError {
  override name = "IndexingFunctionError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, IndexingFunctionError.prototype);
  }
}

export class RpcProviderError extends BaseError {
  override name = "RpcProviderError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, RpcProviderError.prototype);
  }
}

export const nonRetryableUserErrorNames = [
  ShutdownError,
  BuildError,
  MigrationError,
  UniqueConstraintError,
  NotNullConstraintError,
  InvalidStoreAccessError,
  RecordNotFoundError,
  CheckConstraintError,
  InvalidStoreMethodError,
  UndefinedTableError,
  BigIntSerializationError,
  DelayedInsertError,
  RawSqlError,
  IndexingFunctionError,
].map((err) => err.name);
