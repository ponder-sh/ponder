import type { Column, Relation, SQL, Table } from "drizzle-orm";
import type {
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldResolver,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
} from "graphql";
import type {
  ConvertedColumn,
  ConvertedRelationColumnWithArgs,
} from "./type-converter.js";

export type TableNamedRelations = {
  relation: Relation;
  targetTableName: string;
};

export type TableSelectArgs = {
  offset: number;
  limit: number;
  where: Filters<Table>;
  orderBy: OrderByArgs<Table>;
};

export type ProcessedTableSelectArgs = {
  columns: Record<string, true>;
  offset: number;
  limit: number;
  where: SQL;
  orderBy: SQL[];
  with?: Record<string, Partial<ProcessedTableSelectArgs>>;
};

export type SelectedColumnsRaw = [string, true][];

export type SelectedSQLColumns = [string, Column][];

export type SelectedColumns = {
  [columnName in keyof Table["_"]["columns"]]: true;
};

export type CreatedResolver = {
  name: string;
  resolver: GraphQLFieldResolver<any, any>;
  args: GraphQLFieldConfigArgumentMap;
};

export type ArgMapToArgsType<TArgMap extends GraphQLFieldConfigArgumentMap> = {
  [Key in keyof TArgMap]?: TArgMap[Key] extends {
    type: GraphQLScalarType<infer R, any>;
  }
    ? R
    : never;
};

export type ColTypeIsNull<
  TColumn extends Column,
  TColType,
> = TColumn["_"]["notNull"] extends true ? TColType : TColType | null;

export type ColTypeIsNullOrUndefined<
  TColumn extends Column,
  TColType,
> = TColumn["_"]["notNull"] extends true
  ? TColType
  : TColType | null | undefined;

export type ColTypeIsNullOrUndefinedWithDefault<
  TColumn extends Column,
  TColType,
> = TColumn["_"]["notNull"] extends true
  ? TColumn["_"]["hasDefault"] extends true
    ? TColType | null | undefined
    : TColumn["defaultFn"] extends undefined
      ? TColType
      : TColType | null | undefined
  : TColType | null | undefined;

export type GetColumnGqlDataType<TColumn extends Column> =
  TColumn["dataType"] extends "boolean"
    ? ColTypeIsNull<TColumn, boolean>
    : TColumn["dataType"] extends "json"
      ? TColumn["_"]["columnType"] extends "PgGeometryObject"
        ? ColTypeIsNull<
            TColumn,
            {
              x: number;
              y: number;
            }
          >
        : ColTypeIsNull<TColumn, string>
      : TColumn["dataType"] extends "date" | "string" | "bigint"
        ? TColumn["enumValues"] extends [string, ...string[]]
          ? ColTypeIsNull<TColumn, TColumn["enumValues"][number]>
          : ColTypeIsNull<TColumn, string>
        : TColumn["dataType"] extends "number"
          ? ColTypeIsNull<TColumn, number>
          : TColumn["dataType"] extends "buffer"
            ? ColTypeIsNull<TColumn, number[]>
            : TColumn["dataType"] extends "array"
              ? TColumn["columnType"] extends "PgVector"
                ? ColTypeIsNull<TColumn, number[]>
                : TColumn["columnType"] extends "PgGeometry"
                  ? ColTypeIsNullOrUndefinedWithDefault<
                      TColumn,
                      [number, number]
                    >
                  : ColTypeIsNull<
                      TColumn,
                      Array<
                        GetColumnGqlDataType<
                          TColumn extends { baseColumn: Column }
                            ? TColumn["baseColumn"]
                            : never
                        > extends infer InnerColType
                          ? InnerColType extends null | undefined
                            ? never
                            : InnerColType
                          : never
                      >
                    >
              : never;

export type GetColumnGqlInsertDataType<TColumn extends Column> =
  TColumn["dataType"] extends "boolean"
    ? ColTypeIsNullOrUndefinedWithDefault<TColumn, boolean>
    : TColumn["dataType"] extends "json"
      ? TColumn["_"]["columnType"] extends "PgGeometryObject"
        ? ColTypeIsNullOrUndefinedWithDefault<
            TColumn,
            {
              x: number;
              y: number;
            }
          >
        : ColTypeIsNullOrUndefinedWithDefault<TColumn, string>
      : TColumn["dataType"] extends "date" | "string" | "bigint"
        ? TColumn["enumValues"] extends [string, ...string[]]
          ? ColTypeIsNullOrUndefinedWithDefault<
              TColumn,
              TColumn["enumValues"][number]
            >
          : ColTypeIsNullOrUndefinedWithDefault<TColumn, string>
        : TColumn["dataType"] extends "number"
          ? ColTypeIsNullOrUndefinedWithDefault<TColumn, number>
          : TColumn["dataType"] extends "buffer"
            ? ColTypeIsNullOrUndefinedWithDefault<TColumn, number[]>
            : TColumn["dataType"] extends "array"
              ? TColumn["columnType"] extends "PgVector"
                ? ColTypeIsNullOrUndefinedWithDefault<TColumn, number[]>
                : TColumn["columnType"] extends "PgGeometry"
                  ? ColTypeIsNullOrUndefinedWithDefault<
                      TColumn,
                      [number, number]
                    >
                  : ColTypeIsNullOrUndefinedWithDefault<
                      TColumn,
                      Array<
                        GetColumnGqlDataType<
                          TColumn extends { baseColumn: Column }
                            ? TColumn["baseColumn"]
                            : never
                        > extends infer InnerColType
                          ? InnerColType extends null | undefined
                            ? never
                            : InnerColType
                          : never
                      >
                    >
              : never;

export type GetColumnGqlUpdateDataType<TColumn extends Column> =
  TColumn["dataType"] extends "boolean"
    ? boolean | null | undefined
    : TColumn["dataType"] extends "json"
      ? TColumn["_"]["columnType"] extends "PgGeometryObject"
        ?
            | {
                x: number;
                y: number;
              }
            | null
            | undefined
        : string | null | undefined
      : TColumn["dataType"] extends "date" | "string" | "bigint"
        ? TColumn["enumValues"] extends [string, ...string[]]
          ? TColumn["enumValues"][number] | null | undefined
          : string | null | undefined
        : TColumn["dataType"] extends "number"
          ? number | null | undefined
          : TColumn["dataType"] extends "buffer"
            ? number[] | null | undefined
            : TColumn["dataType"] extends "array"
              ? TColumn["columnType"] extends "PgVector"
                ? number[] | null | undefined
                : TColumn["columnType"] extends "PgGeometry"
                  ? [number, number] | null | undefined
                  :
                      | Array<
                          GetColumnGqlDataType<
                            TColumn extends { baseColumn: Column }
                              ? TColumn["baseColumn"]
                              : never
                          > extends infer InnerColType
                            ? InnerColType extends null | undefined
                              ? never
                              : InnerColType
                            : never
                        >
                      | null
                      | undefined
              : never;

export type GetRemappedTableDataType<
  TTable extends Table,
  TColumns extends TTable["_"]["columns"] = TTable["_"]["columns"],
> = {
  [K in keyof TColumns]: GetColumnGqlDataType<TColumns[K]>;
};

export type GetRemappedTableInsertDataType<TTable extends Table> = {
  [K in keyof TTable["_"]["columns"]]: GetColumnGqlInsertDataType<
    TTable["_"]["columns"][K]
  >;
};

export type GetRemappedTableUpdateDataType<TTable extends Table> = {
  [K in keyof TTable["_"]["columns"]]: GetColumnGqlUpdateDataType<
    TTable["_"]["columns"][K]
  >;
};

export type FilterColumnOperatorsCore<
  TColumn extends Column,
  TColType = GetColumnGqlDataType<TColumn>,
> = Partial<{
  eq: TColType;
  ne: TColType;
  lt: TColType;
  lte: TColType;
  gt: TColType;
  gte: TColType;
  like: string;
  notLike: string;
  ilike: string;
  notIlike: string;
  inArray: Array<TColType>;
  notInArray: Array<TColType>;
  isNull: boolean;
  isNotNull: boolean;
}>;

export type FilterColumnOperators<
  TColumn extends Column,
  TOperators extends
    FilterColumnOperatorsCore<TColumn> = FilterColumnOperatorsCore<TColumn>,
> = TOperators & {
  OR?: TOperators[];
};

export type FiltersCore<TTable extends Table> = Partial<{
  [Column in keyof TTable["_"]["columns"]]: FilterColumnOperatorsCore<
    TTable["_"]["columns"][Column]
  >;
}>;

export type Filters<
  TTable extends Table,
  TFilterType = FiltersCore<TTable>,
> = TFilterType & {
  OR?: TFilterType[];
};

export type OrderByArgs<TTable extends Table> = {
  [Key in keyof TTable["_"]["columns"]]?: {
    direction: "asc" | "desc";
    priority: number;
  };
};

export type GeneratedTableTypesInputs = {
  insertInput: GraphQLInputObjectType;
  updateInput: GraphQLInputObjectType;
  tableOrder: GraphQLInputObjectType;
  tableFilters: GraphQLInputObjectType;
};

export type GeneratedTableTypesOutputs<WithReturning extends boolean> =
  WithReturning extends true
    ? {
        selectSingleOutput: GraphQLObjectType;
        selectArrOutput: GraphQLNonNull<
          GraphQLList<GraphQLNonNull<GraphQLObjectType>>
        >;
        singleTableItemOutput: GraphQLObjectType;
        arrTableItemOutput: GraphQLNonNull<
          GraphQLList<GraphQLNonNull<GraphQLObjectType>>
        >;
      }
    : {
        selectSingleOutput: GraphQLObjectType;
        selectArrOutput: GraphQLNonNull<
          GraphQLList<GraphQLNonNull<GraphQLObjectType>>
        >;
      };

export type GeneratedTableTypes<WithReturning extends boolean> = {
  inputs: GeneratedTableTypesInputs;
  outputs: GeneratedTableTypesOutputs<WithReturning>;
};

export type SelectData<TWithOrder extends boolean> = {
  filters: GraphQLInputObjectType;
  tableFields: Record<string, ConvertedColumn>;
  relationFields: Record<string, ConvertedRelationColumnWithArgs>;
  order: TWithOrder extends true ? GraphQLInputObjectType : undefined;
};
