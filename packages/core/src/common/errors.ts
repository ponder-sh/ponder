export class NonRetryableError extends Error {
  override name = "NonRetryableError";

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, NonRetryableError.prototype);
  }
}

export class StoreError extends NonRetryableError {
  override name = "StoreError";

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, StoreError.prototype);
  }
}

export class DatabaseError extends NonRetryableError {
  override name = "DatabaseError";

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
}

export class IgnorableError extends Error {
  override name = "IgnorableError";

  constructor(message?: string) {
    super(message);
    Object.setPrototypeOf(this, IgnorableError.prototype);
  }
}
