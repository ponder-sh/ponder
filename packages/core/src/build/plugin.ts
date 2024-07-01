import MagicString from "magic-string";
import type { Plugin } from "vite";

export const ponderRegex =
  /^import\s+\{[^}]*\bponder\b[^}]*\}\s+from\s+["']@\/generated["'];?.*$/gm;

export const shim = `import { Hono } from "hono";
let __hono__ = new Hono();
export let ponder = {
  hono: __hono__,
  get: __hono__.get,
  post: __hono__.get,
  use: __hono__.use,
  fns: [],
  on(name, fn) {
    this.fns.push({ name, fn });
  },
};
`;

export function replaceStateless(code: string, regex: RegExp, shim: string) {
  const s = new MagicString(code);
  // MagicString.replace calls regex.exec(), which increments `lastIndex`
  // on a match. We have to set this back to zero to use the same regex
  // multiple times.
  regex.lastIndex = 0;
  s.replace(regex, shim);
  return s;
}

export const vitePluginPonder = (): Plugin => {
  return {
    name: "ponder",
    load: (id) => {
      if (id === "ponder:db") {
        return `import schema from "ponder.schema";
import config from "ponder.config";
import { convertToDrizzleTable } from "@ponder/core";
let databaseConfig = undefined
let envSchema = undefined;
let envPublishSchema = undefined;
if (process.env.RAILWAY_DEPLOYMENT_ID && process.env.RAILWAY_SERVICE_NAME) {
  envSchema = \`\${process.env.RAILWAY_SERVICE_NAME}_\${process.env.RAILWAY_DEPLOYMENT_ID.slice(
    0,
    8,
  )}\`;
  envPublishSchema = "public";
} else {
  envSchema = "public";
}
if (config.database?.kind) {
  if (config.database.kind === "postgres") {
    const schema = config.database.schema ?? envSchema;
    const publishSchema = config.database.publishSchema ?? envPublishSchema;
    databaseConfig = { kind: "postgres", schema, publishSchema };
  } else {
    databaseConfig = { kind: "sqlite" };
  }
} else {
  if (process.env.DATABASE_PRIVATE_URL || process.env.DATABASE_URL) {
    const schema = envSchema;
    const publishSchema = envPublishSchema;
    databaseConfig = { kind: "postgres", schema, publishSchema };
  } else {
    databaseConfig = { kind: "sqlite" };
  }
}
let drizzleTables = Object.fromEntries(
  Object.entries(schema).map(([tableName, table]) => [
    tableName,
    convertToDrizzleTable(tableName, table.table, databaseConfig),
  ]),
);
export *  from "@ponder/core/drizzle";
module.exports = drizzleTables;
`;
      }
      return null;
    },
    transform: (code, id) => {
      if (ponderRegex.test(code)) {
        const s = replaceStateless(code, ponderRegex, shim);
        const transformed = s.toString();
        const sourcemap = s.generateMap({ source: id });
        return { code: transformed, map: sourcemap };
      }
      return null;
    },
  };
};
