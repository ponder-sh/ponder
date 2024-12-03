import { BuildError } from "@/common/errors.js";
import { type Schema, isPgEnumSym } from "@/drizzle/index.js";
import { getSql } from "@/drizzle/kit/index.js";
import { buildGraphQLSchema } from "@/graphql/index.js";
import { SQL, getTableColumns, is } from "drizzle-orm";
import {
  PgBigSerial53,
  PgBigSerial64,
  type PgEnum,
  PgSchema,
  PgSequence,
  PgSerial,
  PgSmallSerial,
  PgTable,
  PgView,
  getTableConfig,
} from "drizzle-orm/pg-core";

export const buildSchema = ({
  schema,
  instanceId,
}: { schema: Schema; instanceId: string }) => {
  const statements = getSql(schema, instanceId);

  // find and validate namespace

  let namespace: string;

  for (const maybeSchema of Object.values(schema)) {
    if (is(maybeSchema, PgSchema)) {
      namespace = maybeSchema.schemaName;
      break;
    }
  }

  if (namespace! === undefined) {
    namespace = "public";
  }

  for (const [name, s] of Object.entries(schema)) {
    if (is(s, PgTable)) {
      if (namespace === "public" && getTableConfig(s).schema !== undefined) {
        throw new Error(
          `Schema validation failed: All tables must use the same schema and ${name} uses a different schema '${getTableConfig(s).schema}' than '${namespace}'.`,
        );
      }
      if (namespace !== "public" && getTableConfig(s).schema !== namespace) {
        throw new Error(
          `Schema validation failed: All tables  must use the same schema and ${name} uses a different schema '${getTableConfig(s).schema ?? "public"}' than '${namespace}'.`,
        );
      }

      let hasPrimaryKey = false;

      for (const [columnName, column] of Object.entries(getTableColumns(s))) {
        if (column.primary) {
          if (hasPrimaryKey) {
            throw new Error(
              `Schema validation failed: '${name}' has multiple primary keys.`,
            );
          } else {
            hasPrimaryKey = true;
          }
        }

        if (
          column instanceof PgSerial ||
          column instanceof PgSmallSerial ||
          column instanceof PgBigSerial53 ||
          column instanceof PgBigSerial64
        ) {
          throw new Error(
            `Schema validation failed: '${name}.${columnName}' has a serial column and serial columns are unsupported.`,
          );
        }

        if (column.isUnique) {
          throw new Error(
            `Schema validation failed: '${name}.${columnName}' has a unique constraint and unique constraints are unsupported.`,
          );
        }

        if (column.generated !== undefined) {
          throw new Error(
            `Schema validation failed: '${name}.${columnName}' is a generated column and generated columns are unsupported.`,
          );
        }

        if (column.generatedIdentity !== undefined) {
          throw new Error(
            `Schema validation failed: '${name}.${columnName}' is a generated column and generated columns are unsupported.`,
          );
        }

        if (column.hasDefault) {
          if (column.default && column.default instanceof SQL) {
            throw new Error(
              `Schema validation failed: '${name}.${columnName}' is a default column and default columns with raw sql are unsupported.`,
            );
          }

          if (column.defaultFn && column.defaultFn() instanceof SQL) {
            throw new Error(
              `Schema validation failed: '${name}.${columnName}' is a default column and default columns with raw sql are unsupported.`,
            );
          }

          if (column.onUpdateFn && column.onUpdateFn() instanceof SQL) {
            throw new Error(
              `Schema validation failed: '${name}.${columnName}' is a default column and default columns with raw sql are unsupported.`,
            );
          }
        }
      }

      if (getTableConfig(s).primaryKeys.length > 1) {
        throw new Error(
          `Schema validation failed: '${name}' has multiple primary keys.`,
        );
      }

      if (getTableConfig(s).primaryKeys.length === 1 && hasPrimaryKey) {
        throw new Error(
          `Schema validation failed: '${name}' has multiple primary keys.`,
        );
      }

      if (
        getTableConfig(s).primaryKeys.length === 0 &&
        hasPrimaryKey === false
      ) {
        throw new Error(
          `Schema validation failed: '${name}' has no primary key. Declare one with ".primaryKey()".`,
        );
      }

      if (getTableConfig(s).foreignKeys.length > 0) {
        throw new Error(
          `Schema validation failed: '${name}' has a foreign key constraint and foreign key constraints are unsupported.`,
        );
      }

      if (getTableConfig(s).checks.length > 0) {
        throw new Error(
          `Schema validation failed: '${name}' has a check constraint and check constraints are unsupported.`,
        );
      }

      if (getTableConfig(s).uniqueConstraints.length > 0) {
        throw new Error(
          `Schema validation failed: '${name}' has a unique constraint and unique constraints are unsupported.`,
        );
      }
    }

    if (is(s, PgSequence)) {
      throw new Error(
        `Schema validation failed: '${name}' is a sequence and sequences are unsupported.`,
      );
    }

    if (is(s, PgView)) {
      throw new Error(
        `Schema validation failed: '${name}' is a view and views are unsupported.`,
      );
    }

    // @ts-ignore
    if (isPgEnumSym in s) {
      // @ts-ignore
      if (namespace === "public" && (s as PgEnum<any>).schema !== undefined) {
        throw new Error(
          // @ts-ignore
          `Schema validation failed: All enums must use the same schema and ${name} uses a different schema '${(s as PgEnum<any>).schema}' than '${namespace}'.`,
        );
      }
      // @ts-ignore
      if (namespace !== "public" && (s as PgEnum<any>).schema !== namespace) {
        throw new Error(
          // @ts-ignore
          `Schema validation failed: All enums must use the same schema and ${name} uses a different schema '${(s as PgEnum<any>).schema ?? "public"}' than '${namespace}'.`,
        );
      }
    }
  }

  return { statements, namespace };
};

export const safeBuildSchema = ({
  schema,
  instanceId,
}: { schema: Schema; instanceId: string }) => {
  try {
    const result = buildSchema({ schema, instanceId });
    const graphqlSchema = buildGraphQLSchema(schema);

    return {
      status: "success",
      ...result,
      graphqlSchema,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
};
