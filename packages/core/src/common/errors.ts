export class BaseError extends Error {
  override name = "BaseError";

  meta: string[] = [];

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, BaseError.prototype);
  }
}

export function getBaseError(err: any) {
  if (err instanceof BaseError) return err;
  if (err instanceof Error) return new BaseError(err.message);
  if (typeof err?.message === "string") return new BaseError(err.message);
  if (typeof err === "string") return new BaseError(err);
  return new BaseError("unknown error");
}

export class NonRetryableError extends BaseError {
  override name = "NonRetryableError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, NonRetryableError.prototype);
  }
}

export class IgnorableError extends BaseError {
  override name = "IgnorableError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, IgnorableError.prototype);
  }
}

export class StoreError extends NonRetryableError {
  override name = "StoreError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, StoreError.prototype);
  }
}

export class UniqueConstraintError extends NonRetryableError {
  override name = "UniqueConstraintError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, UniqueConstraintError.prototype);
  }
}

export class NotNullConstraintError extends NonRetryableError {
  override name = "NotNullConstraintError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, NotNullConstraintError.prototype);
  }
}

export class RecordNotFoundError extends NonRetryableError {
  override name = "RecordNotFoundError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, RecordNotFoundError.prototype);
  }
}

export class CheckConstraintError extends NonRetryableError {
  override name = "CheckConstraintError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, CheckConstraintError.prototype);
  }
}

export class BigIntSerializationError extends NonRetryableError {
  override name = "BigIntSerializationError";

  constructor(message?: string | undefined) {
    super(message);
    Object.setPrototypeOf(this, BigIntSerializationError.prototype);
  }
}
