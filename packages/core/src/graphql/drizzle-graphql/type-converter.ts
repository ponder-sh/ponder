import { is } from "drizzle-orm";
import { MySqlInt, MySqlSerial } from "drizzle-orm/mysql-core";
import { PgInteger, PgSerial } from "drizzle-orm/pg-core";
import { SQLiteInteger } from "drizzle-orm/sqlite-core";
import {
  GraphQLBoolean,
  GraphQLEnumType,
  type GraphQLFieldConfig,
  GraphQLFloat,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  type GraphQLScalarType,
  GraphQLString,
} from "graphql";

import type { Column } from "drizzle-orm";
import type { PgArray } from "drizzle-orm/pg-core";
import { capitalize } from "./case-ops.js";

export type ConvertedColumn<TIsInput extends boolean = false> = {
  type:
    | GraphQLScalarType
    | GraphQLEnumType
    | GraphQLNonNull<GraphQLScalarType>
    | GraphQLNonNull<GraphQLEnumType>
    | GraphQLList<GraphQLScalarType>
    | GraphQLList<GraphQLNonNull<GraphQLScalarType>>
    | GraphQLNonNull<GraphQLList<GraphQLScalarType>>
    | GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLScalarType>>>
    | (TIsInput extends true
        ?
            | GraphQLInputObjectType
            | GraphQLNonNull<GraphQLInputObjectType>
            | GraphQLList<GraphQLInputObjectType>
            | GraphQLNonNull<GraphQLList<GraphQLInputObjectType>>
            | GraphQLNonNull<
                GraphQLList<GraphQLNonNull<GraphQLInputObjectType>>
              >
        :
            | GraphQLObjectType
            | GraphQLNonNull<GraphQLObjectType>
            | GraphQLList<GraphQLObjectType>
            | GraphQLNonNull<GraphQLList<GraphQLObjectType>>
            | GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>);
  description?: string;
};

export type ConvertedColumnWithArgs = ConvertedColumn & {
  args?: GraphQLFieldConfig<any, any>["args"];
};

export type ConvertedInputColumn = {
  type: GraphQLInputObjectType;
  description?: string;
};

export type ConvertedRelationColumn = {
  type:
    | GraphQLObjectType
    | GraphQLNonNull<GraphQLObjectType>
    | GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
};

export type ConvertedRelationColumnWithArgs = ConvertedRelationColumn & {
  args?: GraphQLFieldConfig<any, any>["args"];
};

const allowedNameChars = /^[a-zA-Z0-9_]+$/;

const enumMap = new WeakMap<Object, GraphQLEnumType>();
const generateEnumCached = (
  column: Column,
  columnName: string,
  tableName: string,
): GraphQLEnumType => {
  if (enumMap.has(column)) return enumMap.get(column)!;

  const gqlEnum = new GraphQLEnumType({
    name: `${capitalize(tableName)}${capitalize(columnName)}Enum`,
    values: Object.fromEntries(
      column.enumValues!.map((e, index) => [
        allowedNameChars.test(e) ? e : `Option${index}`,
        {
          value: e,
          description: `Value: ${e}`,
        },
      ]),
    ),
  });

  enumMap.set(column, gqlEnum);

  return gqlEnum;
};

const geoXyType = new GraphQLObjectType({
  name: "PgGeometryObject",
  fields: {
    x: { type: GraphQLFloat },
    y: { type: GraphQLFloat },
  },
});

const geoXyInputType = new GraphQLInputObjectType({
  name: "PgGeometryObjectInput",
  fields: {
    x: { type: GraphQLFloat },
    y: { type: GraphQLFloat },
  },
});

const columnToGraphQLCore = (
  column: Column,
  columnName: string,
  tableName: string,
  isInput: boolean,
): ConvertedColumn<boolean> => {
  switch (column.dataType) {
    case "boolean":
      return { type: GraphQLBoolean, description: "Boolean" };
    case "json":
      return column.columnType === "PgGeometryObject"
        ? {
            type: isInput ? geoXyInputType : geoXyType,
            description: "Geometry points XY",
          }
        : { type: GraphQLString, description: "JSON" };
    case "date":
      return { type: GraphQLString, description: "Date" };
    case "string":
      if (column.enumValues?.length)
        return { type: generateEnumCached(column, columnName, tableName) };

      return { type: GraphQLString, description: "String" };
    case "bigint":
      return { type: GraphQLString, description: "BigInt" };
    case "number":
      return is(column, PgInteger) ||
        is(column, PgSerial) ||
        is(column, MySqlInt) ||
        is(column, MySqlSerial) ||
        is(column, SQLiteInteger)
        ? { type: GraphQLInt, description: "Integer" }
        : { type: GraphQLFloat, description: "Float" };
    case "buffer":
      return {
        type: new GraphQLList(new GraphQLNonNull(GraphQLInt)),
        description: "Buffer",
      };
    case "array": {
      if (column.columnType === "PgVector") {
        return {
          type: new GraphQLList(new GraphQLNonNull(GraphQLFloat)),
          description: "Array<Float>",
        };
      }

      if (column.columnType === "PgGeometry") {
        return {
          type: new GraphQLList(new GraphQLNonNull(GraphQLFloat)),
          description: "Tuple<[Float, Float]>",
        };
      }

      const innerType = columnToGraphQLCore(
        (column as Column as PgArray<any, any>).baseColumn,
        columnName,
        tableName,
        isInput,
      );

      return {
        type: new GraphQLList(
          new GraphQLNonNull(innerType.type as GraphQLScalarType),
        ),
        description: `Array<${innerType.description}>`,
      };
    }
    default:
      throw new Error(
        `Drizzle-GraphQL Error: Type ${column.dataType} is not implemented!`,
      );
  }
};

export const drizzleColumnToGraphQLType = <
  TColumn extends Column,
  TIsInput extends boolean,
>(
  column: TColumn,
  columnName: string,
  tableName: string,
  forceNullable = false,
  defaultIsNullable = false,
  isInput: TIsInput = false as TIsInput,
): ConvertedColumn<TIsInput> => {
  const typeDesc = columnToGraphQLCore(column, columnName, tableName, isInput);
  const noDesc = ["string", "boolean", "number"];
  // biome-ignore lint/performance/noDelete: no
  if (noDesc.find((e) => e === column.dataType)) delete typeDesc.description;

  if (forceNullable) return typeDesc as ConvertedColumn<TIsInput>;
  if (
    column.notNull &&
    !(defaultIsNullable && (column.hasDefault || column.defaultFn))
  ) {
    return {
      type: new GraphQLNonNull(typeDesc.type),
      description: typeDesc.description,
    } as ConvertedColumn<TIsInput>;
  }

  return typeDesc as ConvertedColumn<TIsInput>;
};
