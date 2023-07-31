export class UserError extends Error {
  override name = "UserError";

  meta?: string;

  constructor(
    message: string,
    options: { stack?: string; meta?: string; cause?: unknown } = {}
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);

    this.stack = options.stack;
    this.meta = options.meta;
  }
}
