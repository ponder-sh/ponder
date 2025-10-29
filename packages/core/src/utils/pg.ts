import type { Logger } from "@/internal/logger.js";
import pg, { type PoolConfig } from "pg";
import parse from "pg-connection-string";

// The default parser for numeric[] (1231) seems to parse values as Number
// or perhaps through JSON.parse(). Use the int8[] (1016) parser instead,
// which properly returns an array of strings.
const bigIntArrayParser = pg.types.getTypeParser(1016);
pg.types.setTypeParser(1231, bigIntArrayParser);

export const PG_BIGINT_MAX = 9223372036854775807n;
export const PG_INTEGER_MAX = 2147483647;

export function getDatabaseName(connectionString: string) {
  try {
    const parsed = (parse as unknown as typeof parse.parse)(connectionString);
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.host}${port}/${parsed.database}`;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    throw new Error(
      `Failed to parse database connection string: ${errorMessage}.`,
    );
  }
}

export function createPool(config: PoolConfig, logger: Logger) {
  class Client extends pg.Client {
    // @ts-expect-error
    override connect(
      callback: (err: Error) => void | undefined,
    ): void | Promise<void> {
      if (callback) {
        super.connect(() => {
          this.query(
            `
            SET synchronous_commit = off;
            SET idle_in_transaction_session_timeout = 3600000;`,
            callback,
          );
        });
      } else {
        return super.connect().then(() =>
          this.query(`
            SET synchronous_commit = off;
            SET idle_in_transaction_session_timeout = 3600000;`).then(() => {}),
        );
      }
    }
  }

  const pool = new pg.Pool({
    // https://stackoverflow.com/questions/59155572/how-to-set-query-timeout-in-relation-to-statement-timeout
    statement_timeout: 2 * 60 * 1000, // 2 minutes
    // @ts-expect-error: The custom Client is an undocumented option.
    Client: Client,
    ...config,
  });

  function onPoolError(error: Error) {
    const client = (error as any).client as any | undefined;
    const pid = (client?.processID as number | undefined) ?? "unknown";
    const applicationName =
      (client?.connectionParameters?.application_name as string | undefined) ??
      "unknown";

    logger.warn({
      msg: "Postgres pool error",
      application_name: applicationName,
      pid,
      error,
    });

    // NOTE: Errors thrown here cause an uncaughtException. It's better to just log and ignore -
    // if the underlying problem persists, the process will crash due to downstream effects.
  }

  function onClientError(error: Error) {
    logger.warn({ msg: "Postgres client error", error });

    // NOTE: Errors thrown here cause an uncaughtException. It's better to just log and ignore -
    // if the underlying problem persists, the process will crash due to downstream effects.
  }

  function onNotice(notice: { message?: string; code?: string }) {
    const level =
      typeof notice.code === "string" &&
      ["42P06", "42P07"].includes(notice.code)
        ? "trace"
        : "debug";
    logger[level]({
      msg: "Postgres notice",
      message: notice.message,
      code: notice.code,
    });
  }

  pool.on("error", onPoolError);
  pool.on("connect", (client) => {
    client.on("notice", onNotice);
    client.on("error", onClientError);
  });

  return pool;
}

export function createReadonlyPool(
  config: PoolConfig,
  logger: Logger,
  namespace: string,
) {
  class ReadonlyClient extends pg.Client {
    // @ts-expect-error
    override connect(
      callback: (err: Error) => void | undefined,
    ): void | Promise<void> {
      if (callback) {
        super.connect(() => {
          this.query(
            `
          SET search_path = "${namespace}";
          SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
          SET work_mem = '512MB';
          SET lock_timeout = '500ms';`,
            callback,
          );
        });
      } else {
        return super.connect().then(() =>
          this.query(
            `
          SET search_path = "${namespace}";
          SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
          SET work_mem = '512MB';
          SET lock_timeout = '500ms';`,
          ).then(() => {}),
        );
      }
    }
  }

  const pool = new pg.Pool({
    // https://stackoverflow.com/questions/59155572/how-to-set-query-timeout-in-relation-to-statement-timeout
    statement_timeout: 30 * 1000, // 30s
    // @ts-expect-error: The custom Client is an undocumented option.
    Client: ReadonlyClient,
    ...config,
  });

  function onPoolError(error: Error) {
    const client = (error as any).client as any | undefined;
    const pid = (client?.processID as number | undefined) ?? "unknown";
    const applicationName =
      (client?.connectionParameters?.application_name as string | undefined) ??
      "unknown";

    logger.warn({
      msg: "Postgres pool error",
      application_name: applicationName,
      pid,
      error,
    });

    // NOTE: Errors thrown here cause an uncaughtException. It's better to just log and ignore -
    // if the underlying problem persists, the process will crash due to downstream effects.
  }

  function onClientError(error: Error) {
    logger.warn({ msg: "Postgres client error", error });

    // NOTE: Errors thrown here cause an uncaughtException. It's better to just log and ignore -
    // if the underlying problem persists, the process will crash due to downstream effects.
  }

  function onNotice(notice: { message?: string; code?: string }) {
    const level =
      typeof notice.code === "string" &&
      ["42P06", "42P07"].includes(notice.code)
        ? "trace"
        : "debug";
    logger[level]({
      msg: "Postgres notice",
      message: notice.message,
      code: notice.code,
    });
  }

  pool.on("error", onPoolError);
  pool.on("connect", (client) => {
    client.on("notice", onNotice);
    client.on("error", onClientError);
  });

  return pool;
}
