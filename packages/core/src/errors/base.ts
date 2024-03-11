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
