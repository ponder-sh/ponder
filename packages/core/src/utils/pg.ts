import type { Logger } from "@/internal/logger.js";
import pg, { type PoolConfig } from "pg";
import { prettyPrint } from "./print.js";

// The default parser for numeric[] (1231) seems to parse values as Number
// or perhaps through JSON.parse(). Use the int8[] (1016) parser instead,
// which properly returns an array of strings.
const bigIntArrayParser = pg.types.getTypeParser(1016);
pg.types.setTypeParser(1231, bigIntArrayParser);

// Monkeypatch Pool.query to get more informative stack traces. I have no idea why this works.
// https://stackoverflow.com/a/70601114
const originalClientQuery = pg.Client.prototype.query;
// @ts-ignore
pg.Client.prototype.query = function query(
  ...args: [queryText: string, values: any[], callback: () => void]
) {
  try {
    return originalClientQuery.apply(this, args as any);
  } catch (error_) {
    const error = error_ as Error & { detail?: string; meta?: string[] };
    const [statement, parameters_] = args ?? ["empty", []];

    error.name = "PostgresError";

    let parameters = parameters_ ?? [];
    parameters =
      parameters.length <= 25
        ? parameters
        : parameters.slice(0, 26).concat(["..."]);
    const params = parameters.reduce<Record<number, any>>(
      (acc, parameter, idx) => {
        acc[idx + 1] = parameter;
        return acc;
      },
      {},
    );

    error.meta = Array.isArray(error.meta) ? error.meta : [];
    if (error.detail) error.meta.push(`Detail:\n  ${error.detail}`);
    error.meta.push(`Statement:\n  ${statement}`);
    error.meta.push(`Parameters:\n${prettyPrint(params)}`);

    throw error;
  }
};

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

  function onError(error: Error) {
    const client = (error as any).client as any | undefined;
    const pid = (client?.processID as number | undefined) ?? "unknown";
    const applicationName =
      (client?.connectionParameters?.application_name as string | undefined) ??
      "unknown";

    logger.error({
      service: "postgres",
      msg: `Pool error (application_name: ${applicationName}, pid: ${pid})`,
      error,
    });

    // NOTE: Errors thrown here cause an uncaughtException. It's better to just log and ignore -
    // if the underlying problem persists, the process will crash due to downstream effects.
  }

  function onNotice(notice: { message?: string; code?: string }) {
    logger.debug({
      service: "postgres",
      msg: `notice: ${notice.message} (code: ${notice.code})`,
    });
  }

  pool.on("error", onError);
  pool.on("connect", (client) => {
    client.on("notice", onNotice);
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

  function onError(error: Error) {
    const client = (error as any).client as any | undefined;
    const pid = (client?.processID as number | undefined) ?? "unknown";
    const applicationName =
      (client?.connectionParameters?.application_name as string | undefined) ??
      "unknown";

    logger.error({
      service: "postgres",
      msg: `Pool error (application_name: ${applicationName}, pid: ${pid})`,
      error,
    });

    // NOTE: Errors thrown here cause an uncaughtException. It's better to just log and ignore -
    // if the underlying problem persists, the process will crash due to downstream effects.
  }

  function onNotice(notice: { message?: string; code?: string }) {
    logger.debug({
      service: "postgres",
      msg: `notice: ${notice.message} (code: ${notice.code})`,
    });
  }

  pool.on("error", onError);
  pool.on("connect", (client) => {
    client.on("notice", onNotice);
  });

  return pool;
}
