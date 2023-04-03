import { BaseError } from "./base";
import { prettyPrint } from "./utils";

export class EventHandlerError extends BaseError {
  name = "EventHandlerError";

  constructor({
    eventName,
    blockNumber,
    params,
    stackTrace,
    codeFrame,
    cause,
  }: {
    eventName: string;
    blockNumber?: bigint;
    params?: any;
    stackTrace?: string;
    codeFrame?: string;
    cause?: Error;
  }) {
    const shortMessage =
      `Error while handling \`${eventName}\` event` +
      (blockNumber ? ` at block ${blockNumber}` : "");

    const metaMessages = [];

    if (stackTrace) metaMessages.push(`Trace:\n${stackTrace}`);
    if (codeFrame) metaMessages.push(codeFrame);
    if (params) metaMessages.push(`Event params:\n${prettyPrint(params)}`);

    super(shortMessage, {
      metaMessages,
      cause,
    });
  }
}
