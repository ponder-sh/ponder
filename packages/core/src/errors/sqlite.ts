import { BaseError } from "./base";
import { prettyPrint } from "./utils";

export class SqliteError extends BaseError {
  name = "SqliteError";

  constructor({
    statement,
    parameters,
    sqliteError,
  }: {
    statement: string;
    parameters: (string | number | bigint)[];
    sqliteError: Error;
  }) {
    const params = parameters.reduce<Record<number, any>>(
      (acc, parameter, idx) => {
        acc[idx + 1] = parameter;
        return acc;
      },
      {}
    );

    const metaMessages = [];
    metaMessages.push(`Statement:\n  ${statement}`);
    metaMessages.push(`Parameters:\n${prettyPrint(params)}`);

    const shortMessage = `SQLite error: ${sqliteError.message}`;

    super(shortMessage, {
      metaMessages,
    });
  }
}
