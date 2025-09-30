import { sql } from "drizzle-orm";
import { NodePgSession, NodePgTransaction } from "drizzle-orm/node-postgres";
import {
  type PgDatabase,
  PgDialect,
  type PgQueryResultHKT,
} from "drizzle-orm/pg-core";
import type pg from "pg";
import seedrandom from "seedrandom";
import { SEED, SIM_PARAMS } from "./index.js";

export const dbSim = <
  TSchema extends { [name: string]: unknown } = { [name: string]: never },
  TClient extends pg.Pool | pg.PoolClient = pg.Pool | pg.PoolClient,
>(
  db: PgDatabase<PgQueryResultHKT, TSchema> & { $client: TClient },
): PgDatabase<PgQueryResultHKT, TSchema> & { $client: TClient } => {
  const dialect = new PgDialect({ casing: "snake_case" });
  const queryCount = new Map<string, number>();

  const simError = (sql: string, isTransaction: boolean): void => {
    let nonce: number;

    if (queryCount.has(sql)) {
      nonce = queryCount.get(sql)!;
    } else {
      nonce = 0;
    }

    queryCount.set(sql, nonce + 1);

    const DB_ERROR_RATE = isTransaction
      ? SIM_PARAMS.DB_ERROR_RATE_TRANSACTION
      : SIM_PARAMS.DB_ERROR_RATE;

    if (seedrandom(SEED + sql + nonce)() < DB_ERROR_RATE) {
      if (
        sql !== "begin" &&
        sql !== "rollback" &&
        sql !== "commit" &&
        sql.startsWith("savepoint sp") === false &&
        sql.startsWith("rollback to savepoint sp") === false &&
        sql.startsWith("release savepoint sp") === false
      ) {
        // console.log("Simulated error:", sql);
        throw new Error("Connection terminated unexpectedly. Simulated error.");
      }
    }
  };

  // non-transaction queries (retryable)

  const execute = db._.session.execute.bind(db._.session);
  db._.session.execute = async (...args) => {
    simError(dialect.sqlToQuery(args[0]).sql, false);
    return execute(...args);
  };

  const prepareQuery = db._.session.prepareQuery.bind(db._.session);
  db._.session.prepareQuery = (...args) => {
    const result = prepareQuery(...args);
    const execute = result.execute.bind(result);
    result.execute = async (..._args) => {
      simError(args[0].sql, false);
      return execute(..._args);
    };
    return result;
  };

  // transaction queries (non-retryable)

  db.transaction = async (callback, config) => {
    const session = new NodePgSession(
      await db._.session.client.connect(),
      db._.session.dialect,
      db._.session.schema,
      db._.session.options,
    );
    const tx = new NodePgTransaction(
      db._.session.dialect,
      session,
      db._.session.schema,
    );

    const execute = session.execute.bind(session);
    session.execute = async (...args) => {
      simError(dialect.sqlToQuery(args[0]).sql, true);
      return execute(...args);
    };

    const prepareQuery = session.prepareQuery.bind(session);
    session.prepareQuery = (...args) => {
      const result = prepareQuery(...args);
      const execute = result.execute.bind(result);
      result.execute = async (..._args) => {
        simError(args[0].sql, true);
        return execute(..._args);
      };
      return result;
    };

    try {
      await tx.execute(
        sql`begin${config ? sql` ${tx.getTransactionConfigSQL(config)}` : undefined}`,
      );
      const result = await callback(tx);
      await tx.execute(sql`commit`);
      return result;
    } catch (error) {
      await tx.execute(sql`rollback`);
      throw error;
    } finally {
      session.client.release();
    }
  };

  return db;
};
