import { DatabaseError } from "pg";

import { BaseError } from "./base";
import { prettyPrint } from "./utils";

export class PostgresError extends BaseError {
  name = "PostgresError";

  constructor({
    statement,
    parameters,
    pgError,
  }: {
    statement: string;
    parameters: (string | number | bigint)[];
    pgError: DatabaseError;
  }) {
    const params = parameters.reduce<Record<number, any>>(
      (acc, parameter, idx) => {
        acc[idx + 1] =
          typeof parameter === "string" && parameter.length > 80
            ? parameter.slice(0, 80).concat("...")
            : parameter;
        return acc;
      },
      {}
    );

    const metaMessages = [];
    if (pgError.detail) metaMessages.push(`Detail:\n  ${pgError.detail}`);
    metaMessages.push(`Statement:\n  ${statement}`);
    metaMessages.push(`Parameters:\n${prettyPrint(params)}`);

    const shortMessage = `PostgreSQL error: ${pgError.message}`;

    super(shortMessage, {
      metaMessages,
    });
  }
}
