import { prettyPrint } from "@/utils/print";

import { BaseError } from "./base";

export class QueueError extends BaseError {
  override name = "QueueError";

  constructor({
    queueName,
    task,
    cause,
  }: {
    queueName: string;
    task: any;
    cause: Error;
  }) {
    const metaMessages = [];
    metaMessages.push(`Task:\n${prettyPrint(task)}`);
    if (cause.stack) metaMessages.push(`Stack: ${cause.stack}`);

    const shortMessage = `${queueName} error`;

    super(shortMessage, {
      metaMessages,
    });
  }
}
