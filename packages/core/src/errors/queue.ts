import { BaseError } from "./base";
import { prettyPrint } from "./utils";

export class QueueError extends BaseError {
  name = "QueueError";

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
