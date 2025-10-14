import { getSql } from "@/drizzle/kit/index.js";
import { BuildError } from "@/internal/errors.js";
import type { Schema } from "@/internal/types.js";
import {
  SQL,
  getTableColumns,
  getTableName,
  getViewName,
  is,
} from "drizzle-orm";
import {
  PgBigSerial53,
  PgBigSerial64,
  PgColumn,
  PgSequence,
  PgSerial,
  PgSmallSerial,
  PgTable,
  PgView,
  getTableConfig,
  getViewConfig,
} from "drizzle-orm/pg-core";

export const buildSchema = ({ schema }: { schema: Schema }) => {
  const statements = getSql(schema);

  const tableNames = new Set<string>();
  const viewNames = new Set<string>();
  const indexNames = new Set<string>();

  for (const [name, s] of Object.entries(schema)) {
    if (is(s, PgTable)) {
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

      if (tableNames.has(getTableName(s))) {
        throw new Error(
          `Schema validation failed: table name '${getTableName(s)}' is used multiple times.`,
        );
      } else {
        tableNames.add(getTableName(s));
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

      for (const index of getTableConfig(s).indexes) {
        if (index.config.name && indexNames.has(index.config.name)) {
          throw new Error(
            `Schema validation failed: index name '${index.config.name}' is used multiple times.`,
          );
        } else if (index.config.name) {
          indexNames.add(index.config.name);
        }
      }
    }

    if (is(s, PgSequence)) {
      throw new Error(
        `Schema validation failed: '${name}' is a sequence and sequences are unsupported.`,
      );
    }

    if (is(s, PgView)) {
      if (viewNames.has(getViewName(s))) {
        throw new Error(
          `Schema validation failed: view name '${getViewName(s)}' is used multiple times.`,
        );
      } else {
        viewNames.add(getViewName(s));
      }

      const viewConfig = getViewConfig(s);

      if (viewConfig.selectedFields.length === 0) {
        throw new Error(
          `Schema validation failed: view '${getViewName(s)}' has no selected fields.`,
        );
      }

      if (viewConfig.isExisting) {
        throw new Error(
          `Schema validation failed: view '${getViewName(s)}' is an existing view and existing views are unsupported.`,
        );
      }

      if (viewConfig)
        for (const [columnName, column] of Object.entries(
          viewConfig.selectedFields,
        )) {
          if (is(column, PgColumn) === false) {
            throw new Error(
              `Schema validation failed: view '${getViewName(s)}.${columnName}' is a non-column selected field.`,
            );
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

          if ((column as PgColumn).isUnique) {
            throw new Error(
              `Schema validation failed: '${name}.${columnName}' has a unique constraint and unique constraints are unsupported.`,
            );
          }

          if ((column as PgColumn).generated !== undefined) {
            throw new Error(
              `Schema validation failed: '${name}.${columnName}' is a generated column and generated columns are unsupported.`,
            );
          }

          if ((column as PgColumn).generatedIdentity !== undefined) {
            throw new Error(
              `Schema validation failed: '${name}.${columnName}' is a generated column and generated columns are unsupported.`,
            );
          }
        }
    }
  }

  return { statements };
};

export const safeBuildSchema = ({ schema }: { schema: Schema }) => {
  try {
    const result = buildSchema({ schema });

    return {
      status: "success",
      ...result,
    } as const;
  } catch (_error) {
    const buildError = new BuildError((_error as Error).message);
    buildError.stack = undefined;
    return { status: "error", error: buildError } as const;
  }
};
