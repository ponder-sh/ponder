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

  const simError = (sql: string): void => {
    let nonce: number;

    if (queryCount.has(sql)) {
      nonce = queryCount.get(sql)!;
    } else {
      nonce = 0;
    }

    queryCount.set(sql, nonce + 1);

    if (seedrandom(SEED + sql + nonce)() < SIM_PARAMS.DB_ERROR_RATE) {
      throw new Error("Simulated error");
    }
  };

  // non-transaction queries (retryable)

  const execute = db._.session.execute.bind(db._.session);
  db._.session.execute = async (...args) => {
    simError(dialect.sqlToQuery(args[0]).sql);
    return execute(...args);
  };

  const prepareQuery = db._.session.prepareQuery.bind(db._.session);
  db._.session.prepareQuery = (...args) => {
    const result = prepareQuery(...args);
    const execute = result.execute.bind(result);
    result.execute = async (..._args) => {
      simError(args[0].sql);
      return execute(..._args);
    };
    return result;
  };

  // transaction queries (non-retryable)

  const transaction = db._.session.transaction.bind(db._.session);
  db._.session.transaction = async (...args) => {
    const callback = args[0];
    args[0] = async (..._args) => {
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

      const execute = tx._.session.execute.bind(tx._.session);

      tx._.session.execute = async (...args) => {
        simError(dialect.sqlToQuery(args[0]).sql);
        return execute(...args);
      };

      const prepareQuery = tx._.session.prepareQuery.bind(tx._.session);
      // @ts-ignore
      tx._.session.prepareQuery = (...args) => {
        const result = prepareQuery(...args);
        const execute = result.execute.bind(result);
        result.execute = async (..._args) => {
          simError(args[0].sql);
          return execute(..._args);
        };
        return result;
      };

      try {
        return await callback(tx);
      } finally {
        tx._.session.client.release();
      }
    };

    simError("begin");
    return transaction(...args);
  };

  return db;
  // ac1031ac83fe41185df62acf2fde945906166f5a0ab602f7f242cead73270617
};
