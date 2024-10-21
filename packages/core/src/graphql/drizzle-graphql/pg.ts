import {
  type Relation,
  Relations,
  type Table,
  createTableRelationsHelpers,
  is,
} from "drizzle-orm";
import { type PgDatabase, PgTable } from "drizzle-orm/pg-core";
import {
  GraphQLError,
  type GraphQLInputObjectType,
  GraphQLInt,
  type GraphQLObjectType,
} from "graphql";

import { parseResolveInfo } from "graphql-parse-resolve-info";
import {
  extractFilters,
  extractOrderBy,
  extractRelationsParams,
  extractSelectedColumnsFromTree,
  generateTableTypes,
} from "./common.js";
import {
  remapToGraphQLArrayOutput,
  remapToGraphQLSingleOutput,
} from "./data-mappers.js";

import type { RelationalQueryBuilder } from "drizzle-orm/pg-core/query-builders/query";
import type {
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  ThunkObjMap,
} from "graphql";
import type { ResolveTree } from "graphql-parse-resolve-info";
import { capitalize, uncapitalize } from "./case-ops.js";
import type {
  CreatedResolver,
  TableNamedRelations,
  TableSelectArgs,
} from "./types.js";

const generateSelectArray = (
  db: PgDatabase<any, any, any>,
  tableName: string,
  tables: Record<string, Table>,
  relationMap: Record<string, Record<string, TableNamedRelations>>,
  orderArgs: GraphQLInputObjectType,
  filterArgs: GraphQLInputObjectType,
): CreatedResolver => {
  const queryName = `${uncapitalize(tableName)}`;
  const queryBase = db.query[tableName as keyof typeof db.query] as unknown as
    | RelationalQueryBuilder<any, any>
    | undefined;
  if (!queryBase) {
    throw new Error(
      `Drizzle-GraphQL Error: Table ${tableName} not found in drizzle instance. Did you forget to pass schema to drizzle constructor?`,
    );
  }

  const queryArgs = {
    offset: {
      type: GraphQLInt,
    },
    limit: {
      type: GraphQLInt,
    },
    orderBy: {
      type: orderArgs,
    },
    where: {
      type: filterArgs,
    },
  } as GraphQLFieldConfigArgumentMap;

  const typeName = `${capitalize(tableName)}SelectItem`;
  const table = tables[tableName]!;

  return {
    name: queryName,
    resolver: async (
      _source,
      args: Partial<TableSelectArgs>,
      _context,
      info,
    ) => {
      try {
        const { offset, limit, orderBy, where } = args;

        const parsedInfo = parseResolveInfo(info, {
          deep: true,
        }) as ResolveTree;

        const query = queryBase.findMany({
          columns: extractSelectedColumnsFromTree(
            parsedInfo.fieldsByTypeName[typeName]!,
            table,
          ) /*extractSelectedColumnsFromNode(tableSelection, info.fragments, table) */,
          offset,
          limit,
          orderBy: orderBy ? extractOrderBy(table, orderBy) : undefined,
          where: where ? extractFilters(table, tableName, where) : undefined,
          with: relationMap[tableName]
            ? extractRelationsParams(
                relationMap,
                tables,
                tableName,
                parsedInfo,
                typeName,
              )
            : undefined,
        });

        const result = await query;

        return remapToGraphQLArrayOutput(result, tableName, table, relationMap);
      } catch (e) {
        if (typeof e === "object" && typeof (<any>e).message === "string") {
          throw new GraphQLError((<any>e).message);
        }

        throw e;
      }
    },
    args: queryArgs,
  };
};

const generateSelectSingle = (
  db: PgDatabase<any, any, any>,
  tableName: string,
  tables: Record<string, Table>,
  relationMap: Record<string, Record<string, TableNamedRelations>>,
  orderArgs: GraphQLInputObjectType,
  filterArgs: GraphQLInputObjectType,
): CreatedResolver => {
  const queryName = `${uncapitalize(tableName)}Single`;
  const queryBase = db.query[tableName as keyof typeof db.query] as unknown as
    | RelationalQueryBuilder<any, any>
    | undefined;
  if (!queryBase) {
    throw new Error(
      `Drizzle-GraphQL Error: Table ${tableName} not found in drizzle instance. Did you forget to pass schema to drizzle constructor?`,
    );
  }

  const queryArgs = {
    offset: {
      type: GraphQLInt,
    },
    orderBy: {
      type: orderArgs,
    },
    where: {
      type: filterArgs,
    },
  } as GraphQLFieldConfigArgumentMap;

  const typeName = `${capitalize(tableName)}SelectItem`;
  const table = tables[tableName]!;

  return {
    name: queryName,
    resolver: async (
      _source,
      args: Partial<TableSelectArgs>,
      _context,
      info,
    ) => {
      try {
        const { offset, orderBy, where } = args;

        const parsedInfo = parseResolveInfo(info, {
          deep: true,
        }) as ResolveTree;

        const query = queryBase.findFirst({
          columns: extractSelectedColumnsFromTree(
            parsedInfo.fieldsByTypeName[typeName]!,
            table,
          ),
          offset,
          orderBy: orderBy ? extractOrderBy(table, orderBy) : undefined,
          where: where ? extractFilters(table, tableName, where) : undefined,
          with: relationMap[tableName]
            ? extractRelationsParams(
                relationMap,
                tables,
                tableName,
                parsedInfo,
                typeName,
              )
            : undefined,
        });

        const result = await query;
        if (!result) return undefined;

        return remapToGraphQLSingleOutput(
          result,
          tableName,
          table,
          relationMap,
        );
      } catch (e) {
        if (typeof e === "object" && typeof (<any>e).message === "string") {
          throw new GraphQLError((<any>e).message);
        }

        throw e;
      }
    },
    args: queryArgs,
  };
};

export const generateSchemaData = <
  TDrizzleInstance extends PgDatabase<any, any, any>,
  TSchema extends Record<string, Table | unknown>,
>(
  db: TDrizzleInstance,
  schema: TSchema,
  relationsDepthLimit: number | undefined,
): any => {
  const rawSchema = schema;
  const schemaEntries = Object.entries(rawSchema);

  const tableEntries = schemaEntries.filter(([key, value]) =>
    is(value, PgTable),
  ) as [string, PgTable][];
  const tables = Object.fromEntries(tableEntries) as Record<string, PgTable>;

  if (!tableEntries.length) {
    throw new Error(
      "Drizzle-GraphQL Error: No tables detected in Drizzle-ORM's database instance. Did you forget to pass schema to drizzle constructor?",
    );
  }

  const rawRelations = schemaEntries
    .filter(([key, value]) => is(value, Relations))
    .map<[string, Relations]>(([key, value]) => [
      tableEntries.find(
        ([tableName, tableValue]) => tableValue === (value as Relations).table,
      )![0] as string,
      value as Relations,
    ])
    .map<[string, Record<string, Relation>]>(([tableName, relValue]) => [
      tableName,
      relValue.config(createTableRelationsHelpers(tables[tableName]!)),
    ]);

  const namedRelations = Object.fromEntries(
    rawRelations.map(([relName, config]) => {
      const namedConfig: Record<string, TableNamedRelations> =
        Object.fromEntries(
          Object.entries(config).map(([innerRelName, innerRelValue]) => [
            innerRelName,
            {
              relation: innerRelValue,
              targetTableName: tableEntries.find(
                ([tableName, tableValue]) =>
                  tableValue === innerRelValue.referencedTable,
              )![0],
            },
          ]),
        );

      return [relName, namedConfig];
    }),
  );

  const queries: ThunkObjMap<GraphQLFieldConfig<any, any>> = {};
  const gqlSchemaTypes = Object.fromEntries(
    Object.entries(tables).map(([tableName, table]) => [
      tableName,
      generateTableTypes(
        tableName,
        tables,
        namedRelations,
        true,
        relationsDepthLimit,
      ),
    ]),
  );

  const inputs: Record<string, GraphQLInputObjectType> = {};
  const outputs: Record<string, GraphQLObjectType> = {};

  for (const [tableName, tableTypes] of Object.entries(gqlSchemaTypes)) {
    const { insertInput, updateInput, tableFilters, tableOrder } =
      tableTypes.inputs;
    const {
      selectSingleOutput,
      selectArrOutput,
      singleTableItemOutput,
      arrTableItemOutput,
    } = tableTypes.outputs;

    const selectArrGenerated = generateSelectArray(
      db,
      tableName,
      tables,
      namedRelations,
      tableOrder,
      tableFilters,
    );
    const selectSingleGenerated = generateSelectSingle(
      db,
      tableName,
      tables,
      namedRelations,
      tableOrder,
      tableFilters,
    );

    queries[selectArrGenerated.name] = {
      type: selectArrOutput,
      args: selectArrGenerated.args,
      resolve: selectArrGenerated.resolver,
    };
    queries[selectSingleGenerated.name] = {
      type: selectSingleOutput,
      args: selectSingleGenerated.args,
      resolve: selectSingleGenerated.resolver,
    };

    [insertInput, updateInput, tableFilters, tableOrder].forEach(
      (e) => (inputs[e.name] = e),
    );
    outputs[selectSingleOutput.name] = selectSingleOutput;
    outputs[singleTableItemOutput.name] = singleTableItemOutput;
  }

  return { queries, inputs, types: outputs } as any;
};
