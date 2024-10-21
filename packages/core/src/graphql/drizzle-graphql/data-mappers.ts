import type { Column, Table } from "drizzle-orm";
import { GraphQLError } from "graphql";
import type { TableNamedRelations } from "./types.js";

export const remapToGraphQLCore = (
  key: string,
  value: any,
  tableName: string,
  column: Column,
  relationMap?: Record<string, Record<string, TableNamedRelations>>,
): any => {
  if (value instanceof Date) return value.toISOString();

  if (value instanceof Buffer) return Array.from(value);

  if (typeof value === "bigint") return value.toString();

  if (Array.isArray(value)) {
    const relations = relationMap?.[tableName];
    if (relations?.[key]) {
      return remapToGraphQLArrayOutput(
        value as Record<string, any>[],
        relations[key]!.targetTableName,
        relations[key]!.relation.referencedTable,
        relationMap,
      );
    }
    if (column.columnType === "PgGeometry" || column.columnType === "PgVector")
      return value;

    return value.map((arrVal) =>
      remapToGraphQLCore(key, arrVal, tableName, column, relationMap),
    );
  }

  if (typeof value === "object") {
    const relations = relationMap?.[tableName];
    if (relations?.[key]) {
      return remapToGraphQLSingleOutput(
        value,
        relations[key]!.targetTableName,
        relations[key]!.relation.referencedTable,
        relationMap,
      );
    }
    if (column.columnType === "PgGeometryObject") return value;

    return JSON.stringify(value);
  }

  return value;
};

export const remapToGraphQLSingleOutput = (
  queryOutput: Record<string, any>,
  tableName: string,
  table: Table,
  relationMap?: Record<string, Record<string, TableNamedRelations>>,
) => {
  for (const [key, value] of Object.entries(queryOutput)) {
    if (value === undefined || value === null) {
      delete queryOutput[key];
    } else {
      queryOutput[key] = remapToGraphQLCore(
        key,
        value,
        tableName,
        table[key as keyof Table]! as Column,
        relationMap,
      );
    }
  }

  return queryOutput;
};

export const remapToGraphQLArrayOutput = (
  queryOutput: Record<string, any>[],
  tableName: string,
  table: Table,
  relationMap?: Record<string, Record<string, TableNamedRelations>>,
) => {
  for (const entry of queryOutput) {
    remapToGraphQLSingleOutput(entry, tableName, table, relationMap);
  }

  return queryOutput;
};

export const remapFromGraphQLCore = (
  value: any,
  column: Column,
  columnName: string,
) => {
  switch (column.dataType) {
    case "date": {
      const formatted = new Date(value);
      if (Number.isNaN(formatted.getTime()))
        throw new GraphQLError(`Field '${columnName}' is not a valid date!`);

      return formatted;
    }

    case "buffer": {
      if (!Array.isArray(value)) {
        throw new GraphQLError(`Field '${columnName}' is not an array!`);
      }

      return Buffer.from(value);
    }

    case "json": {
      if (column.columnType === "PgGeometryObject") return value;

      try {
        return JSON.parse(value);
      } catch (e) {
        throw new GraphQLError(
          `Invalid JSON in field '${columnName}':\n${e instanceof Error ? e.message : "Unknown error"}`,
        );
      }
    }

    case "array": {
      if (!Array.isArray(value)) {
        throw new GraphQLError(`Field '${columnName}' is not an array!`);
      }

      if (column.columnType === "PgGeometry" && value.length !== 2) {
        throw new GraphQLError(
          `Invalid float tuple in field '${columnName}': expected array with length of 2, received ${value.length}`,
        );
      }

      return value;
    }

    case "bigint": {
      try {
        return BigInt(value);
      } catch (error) {
        throw new GraphQLError(`Field '${columnName}' is not a BigInt!`);
      }
    }

    default: {
      return value;
    }
  }
};
