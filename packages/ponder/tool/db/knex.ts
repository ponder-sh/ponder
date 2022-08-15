import { knex } from "knex";
import knexSchemaInspector from "knex-schema-inspector";

import { logger } from "../logger";

const db = knex({
  client: "sqlite3",
  connection: {
    filename: ":memory:",
  },
  migrations: {
    tableName: "knex_migrations",
  },
  useNullAsDefault: true,
});

const inspector = knexSchemaInspector(db);

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

const getTableNames = async () => {
  const tables = await inspector.tables();
  return tables;
};

export { db, getTableNames };
