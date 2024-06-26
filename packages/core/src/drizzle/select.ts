import type {
  Assume,
  Column,
  MakeColumnConfig,
  QueryPromise,
  SelectedFieldsOrdered as SelectFieldsOrderedBase,
  SelectedFields,
  Subquery,
  Table,
  UpdateTableConfig,
  entityKind,
} from "drizzle-orm";
import type { TypedQueryBuilder } from "drizzle-orm/query-builders/query-builder";
import type {
  AppendToNullabilityMap,
  AppendToResult,
  BuildSubquerySelection,
  GetSelectTableName,
  GetSelectTableSelection,
  JoinNullability,
  JoinType,
  SelectMode,
  SelectResult,
  SetOperator,
} from "drizzle-orm/query-builders/select.types";
import type { ColumnsSelection, Placeholder, SQL, View } from "drizzle-orm/sql";
import type { TableWithColumns, ViewWithSelection } from "./table.js";

export type SelectBuilder<
  TSelection extends SelectedFields<Column, Table> | undefined,
  TResultType extends "sync" | "async",
  TRunResult,
  TBuilderMode extends "db" | "qb" = "db",
> = {
  from: <TFrom extends Table | Subquery | View | SQL>(
    source: TFrom,
  ) => CreateSelectFromBuilderMode<
    TBuilderMode,
    GetSelectTableName<TFrom>,
    TResultType,
    TRunResult,
    TSelection extends undefined ? GetSelectTableSelection<TFrom> : TSelection,
    TSelection extends undefined ? "single" : "partial"
  >;
};

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L31
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L30
 */
export type SelectJoinConfig = {
  on: SQL;
  table: Table | Subquery | View | SQL;
  alias: string | undefined;
  joinType: JoinType;
};

export type Join<
  T extends AnySelectQueryBuilder,
  TDynamic extends boolean,
  TJoinType extends JoinType,
  TJoinedTable extends Table | Subquery | View | SQL,
  TJoinedName extends
    GetSelectTableName<TJoinedTable> = GetSelectTableName<TJoinedTable>,
> = T extends any
  ? SelectWithout<
      SelectKind<
        T["_"]["hkt"],
        T["_"]["tableName"],
        T["_"]["resultType"],
        T["_"]["runResult"],
        AppendToResult<
          T["_"]["tableName"],
          T["_"]["selection"],
          TJoinedName,
          TJoinedTable extends Table
            ? TJoinedTable["_"]["columns"]
            : TJoinedTable extends Subquery | View
              ? Assume<
                  TJoinedTable["_"]["selectedFields"],
                  SelectedFields<Column, Table>
                >
              : never,
          T["_"]["selectMode"]
        >,
        T["_"]["selectMode"] extends "partial"
          ? T["_"]["selectMode"]
          : "multiple",
        AppendToNullabilityMap<
          T["_"]["nullabilityMap"],
          TJoinedName,
          TJoinType
        >,
        T["_"]["dynamic"],
        T["_"]["excludedMethods"]
      >,
      TDynamic,
      T["_"]["excludedMethods"]
    >
  : never;

export type JoinFn<
  T extends AnySelectQueryBuilder,
  TDynamic extends boolean,
  TJoinType extends JoinType,
> = <
  TJoinedTable extends Table | Subquery | View | SQL,
  TJoinedName extends
    GetSelectTableName<TJoinedTable> = GetSelectTableName<TJoinedTable>,
>(
  table: TJoinedTable,
  on: ((aliases: T["_"]["selection"]) => SQL | undefined) | SQL | undefined,
) => Join<T, TDynamic, TJoinType, TJoinedTable, TJoinedName>;

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/query-builders/select.types.ts#L75
 */
type MapColumnsToTableAlias<
  TColumns extends ColumnsSelection,
  TAlias extends string,
> = {
  [Key in keyof TColumns]: TColumns[Key] extends Column
    ? Column<MakeColumnConfig<Assume<TColumns[Key], Column>["_"], TAlias>>
    : TColumns[Key];
} & {};

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L38
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L30
 */
export type BuildAliasTable<
  tableOrView extends Table | View,
  alias extends string,
> = tableOrView extends Table
  ? TableWithColumns<
      UpdateTableConfig<
        tableOrView["_"]["config"],
        {
          name: alias;
          columns: MapColumnsToTableAlias<tableOrView["_"]["columns"], alias>;
        }
      >
    >
  : tableOrView extends View
    ? ViewWithSelection<
        alias,
        tableOrView["_"]["existing"],
        MapColumnsToTableAlias<tableOrView["_"]["selectedFields"], alias>
      >
    : never;

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L52
 */
export type SelectConfig = {
  withList?: Subquery[];
  fields: Record<string, unknown>;
  fieldsFlat?: SelectedFieldsOrdered;
  where?: SQL;
  having?: SQL;
  table: Table | Subquery | View | SQL;
  limit?: number | Placeholder;
  offset?: number | Placeholder;
  joins?: SelectJoinConfig[];
  orderBy?: (Column | SQL | SQL.Aliased)[];
  groupBy?: (Column | SQL | SQL.Aliased)[];
  distinct?: boolean;
  setOperators: {
    rightSelect: TypedQueryBuilder<any, any>;
    type: SetOperator;
    isAll: boolean;
    orderBy?: (Column | SQL | SQL.Aliased)[];
    limit?: number | Placeholder;
    offset?: number | Placeholder;
  }[];
};

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L122
 */
export type SelectedFieldsOrdered = SelectFieldsOrderedBase<Column>;

export type SelectHKTBase = {
  tableName: string | undefined;
  resultType: "sync" | "async";
  runResult: unknown;
  selection: unknown;
  selectMode: SelectMode;
  nullabilityMap: unknown;
  dynamic: boolean;
  excludedMethods: string;
  result: unknown;
  selectedFields: unknown;
  _type: unknown;
};

export interface SelectHKT extends SelectHKTBase {
  _type: SelectBase<
    this["tableName"],
    this["resultType"],
    this["runResult"],
    Assume<this["selection"], ColumnsSelection>,
    this["selectMode"],
    Assume<this["nullabilityMap"], Record<string, JoinNullability>>,
    this["dynamic"],
    this["excludedMethods"],
    Assume<this["result"], any[]>,
    Assume<this["selectedFields"], ColumnsSelection>
  >;
}

export type SelectKind<
  T extends SelectHKTBase,
  TTableName extends string | undefined,
  TResultType extends "sync" | "async",
  TRunResult,
  TSelection extends ColumnsSelection,
  TSelectMode extends SelectMode,
  TNullabilityMap extends Record<string, JoinNullability>,
  TDynamic extends boolean,
  TExcludedMethods extends string,
  TResult = SelectResult<TSelection, TSelectMode, TNullabilityMap>[],
  TSelectedFields = BuildSubquerySelection<TSelection, TNullabilityMap>,
> = (T & {
  tableName: TTableName;
  resultType: TResultType;
  runResult: TRunResult;
  selection: TSelection;
  selectMode: TSelectMode;
  nullabilityMap: TNullabilityMap;
  dynamic: TDynamic;
  excludedMethods: TExcludedMethods;
  result: TResult;
  selectedFields: TSelectedFields;
})["_type"];

export interface SelectQueryBuilderHKT extends SelectHKTBase {
  _type: SelectQueryBuilderBase<
    SelectQueryBuilderHKT,
    this["tableName"],
    this["resultType"],
    this["runResult"],
    Assume<this["selection"], ColumnsSelection>,
    this["selectMode"],
    Assume<this["nullabilityMap"], Record<string, JoinNullability>>,
    this["dynamic"],
    this["excludedMethods"],
    Assume<this["result"], any[]>,
    Assume<this["selectedFields"], ColumnsSelection>
  >;
}

/**
 * Partial implementation of the select query builder
 *
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.ts#L126
 */
export type SelectQueryBuilderBase<
  THKT extends SelectHKTBase,
  TTableName extends string | undefined,
  TResultType extends "sync" | "async",
  TRunResult,
  TSelection extends ColumnsSelection,
  TSelectMode extends SelectMode,
  TNullabilityMap extends Record<
    string,
    JoinNullability
  > = TTableName extends string ? Record<TTableName, "not-null"> : {},
  TDynamic extends boolean = false,
  TExcludedMethods extends string = never,
  TResult extends any[] = SelectResult<
    TSelection,
    TSelectMode,
    TNullabilityMap
  >[],
  TSelectedFields extends ColumnsSelection = BuildSubquerySelection<
    TSelection,
    TNullabilityMap
  >,
> = TypedQueryBuilder<TSelectedFields, TResult> & {
  [entityKind]: string;
  _: {
    readonly hkt: THKT;
    readonly tableName: TTableName;
    readonly resultType: TResultType;
    readonly runResult: TRunResult;
    readonly selection: TSelection;
    readonly selectMode: TSelectMode;
    readonly nullabilityMap: TNullabilityMap;
    readonly dynamic: TDynamic;
    readonly excludedMethods: TExcludedMethods;
    readonly result: TResult;
    readonly selectedFields: TSelectedFields;
  };

  leftJoin: JoinFn<
    SelectQueryBuilderBase<
      THKT,
      TTableName,
      TResultType,
      TRunResult,
      TSelection,
      TSelectMode,
      TNullabilityMap,
      TDynamic,
      TExcludedMethods,
      TResult,
      TSelectedFields
    >,
    TDynamic,
    "left"
  >;

  rightJoin: JoinFn<
    SelectQueryBuilderBase<
      THKT,
      TTableName,
      TResultType,
      TRunResult,
      TSelection,
      TSelectMode,
      TNullabilityMap,
      TDynamic,
      TExcludedMethods,
      TResult,
      TSelectedFields
    >,
    TDynamic,
    "right"
  >;

  innerJoin: JoinFn<
    SelectQueryBuilderBase<
      THKT,
      TTableName,
      TResultType,
      TRunResult,
      TSelection,
      TSelectMode,
      TNullabilityMap,
      TDynamic,
      TExcludedMethods,
      TResult,
      TSelectedFields
    >,
    TDynamic,
    "inner"
  >;

  fullJoin: JoinFn<
    SelectQueryBuilderBase<
      THKT,
      TTableName,
      TResultType,
      TRunResult,
      TSelection,
      TSelectMode,
      TNullabilityMap,
      TDynamic,
      TExcludedMethods,
      TResult,
      TSelectedFields
    >,
    TDynamic,
    "full"
  >;

  where: (
    where: ((aliases: TSelection) => SQL | undefined) | SQL | undefined,
  ) => SelectWithout<
    SelectQueryBuilderBase<
      THKT,
      TTableName,
      TResultType,
      TRunResult,
      TSelection,
      TSelectMode,
      TNullabilityMap,
      TDynamic,
      TExcludedMethods,
      TResult,
      TSelectedFields
    >,
    TDynamic,
    "where"
  >;
};

export type CreateSelectFromBuilderMode<
  TBuilderMode extends "db" | "qb",
  TTableName extends string | undefined,
  TResultType extends "sync" | "async",
  TRunResult,
  TSelection extends ColumnsSelection,
  TSelectMode extends SelectMode,
> = TBuilderMode extends "db"
  ? SelectBase<TTableName, TResultType, TRunResult, TSelection, TSelectMode>
  : SelectQueryBuilderBase<
      SelectQueryBuilderHKT,
      TTableName,
      TResultType,
      TRunResult,
      TSelection,
      TSelectMode
    >;

export type AnySelectQueryBuilder = SelectQueryBuilderBase<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any
>;

type SelectWithout<
  T extends AnySelectQueryBuilder,
  TDynamic extends boolean,
  K extends keyof T & string,
  TResetExcluded extends boolean = false,
> = TDynamic extends true
  ? T
  : Omit<
      SelectKind<
        T["_"]["hkt"],
        T["_"]["tableName"],
        T["_"]["resultType"],
        T["_"]["runResult"],
        T["_"]["selection"],
        T["_"]["selectMode"],
        T["_"]["nullabilityMap"],
        TDynamic,
        TResetExcluded extends true ? K : T["_"]["excludedMethods"] | K,
        T["_"]["result"],
        T["_"]["selectedFields"]
      >,
      TResetExcluded extends true ? K : T["_"]["excludedMethods"] | K
    >;

export type SelectBase<
  TTableName extends string | undefined,
  TResultType extends "sync" | "async",
  TRunResult,
  TSelection extends ColumnsSelection,
  TSelectMode extends SelectMode = "single",
  TNullabilityMap extends Record<
    string,
    JoinNullability
  > = TTableName extends string ? Record<TTableName, "not-null"> : {},
  TDynamic extends boolean = false,
  TExcludedMethods extends string = never,
  TResult = SelectResult<TSelection, TSelectMode, TNullabilityMap>[],
  TSelectedFields extends ColumnsSelection = BuildSubquerySelection<
    TSelection,
    TNullabilityMap
  >,
> = SelectQueryBuilderBase<
  SelectHKT,
  TTableName,
  TResultType,
  TRunResult,
  TSelection,
  TSelectMode,
  TNullabilityMap,
  TDynamic,
  TExcludedMethods,
  // @ts-ignore
  TResult,
  TSelectedFields
> &
  QueryPromise<TResult>;
