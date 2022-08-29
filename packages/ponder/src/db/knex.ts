import type { Knex } from "knex";
import { knex } from "knex";
import knexSchemaInspector from "knex-schema-inspector";

import { logger } from "../utils/logger";

const buildDb = () => {
  const db = knex({
    client: "sqlite3",
    connection: {
      filename: ":memory:",
    },
    useNullAsDefault: true,
  });

  db.on("query-response", (response, data) => {
    if (data.bindings && data.bindings.length > 0) {
      logger.debug(
        `\x1b[33m${"QUERY"}\x1b[0m`, // yellow
        `\x1b[36m${data.sql}\x1b[0m` // cyan
      );
      logger.debug(
        `\x1b[32m${JSON.stringify(data.bindings)}\x1b[0m`, // green
        "\n"
      );
    } else {
      logger.debug(
        `\x1b[33m${"QUERY"}\x1b[0m`, // yellow
        `\x1b[36m${data.sql}\x1b[0m`, // cyan
        "\n"
      );
    }
  });

  db.on("query-error", (error, data) => {
    logger.error(
      `\x1b[33m${"ERROR"}\x1b[0m`, // yellow
      `\x1b[31m${error.message}\x1b[0m`, // red
      "\n"
    );
  });

  return db;
};

const getTableNames = async (db: Knex) => {
  const inspector = knexSchemaInspector(db);
  const tables = await inspector.tables();
  return tables;
};

// Build default DB used by ponder (for now)
const db = buildDb();

export { buildDb, db, getTableNames };
