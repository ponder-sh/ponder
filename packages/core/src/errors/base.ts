type BaseErrorParameters = {
  metaMessages?: string[];
} & (
  | {
      cause?: never;
      details?: string;
    }
  | {
      cause: BaseError | Error;
      details?: never;
    }
);

export class BaseError extends Error {
  details?: string;
  docsPath?: string;
  metaMessages?: string[];
  shortMessage: string;

  name = "PonderError";

  constructor(shortMessage: string, args: BaseErrorParameters = {}) {
    const details =
      args.cause instanceof BaseError
        ? args.cause.details
        : args.cause?.message
        ? args.cause.message
        : args.details;

    const message = [
      shortMessage || "An error occurred.",
      // "",
      ...(args.metaMessages ? [...args.metaMessages, ""] : []),
      ...(details ? [`Details: ${details}`] : []),
    ].join("\n");

    super(message);

    if (args.cause) this.cause = args.cause;
    if (!details) this.details = message;
    this.metaMessages = args.metaMessages;
    this.shortMessage = shortMessage;
  }
}
