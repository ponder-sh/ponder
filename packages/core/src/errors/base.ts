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

// Adapted from viem.
// https://github.com/wagmi-dev/viem/blob/021ce8e5a3fb02db6139564345a91fc77cba08a6/src/errors/base.ts#L17
export class BaseError extends Error {
  details?: string;
  metaMessages?: string[];
  shortMessage: string;

  override name = "PonderError";

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
