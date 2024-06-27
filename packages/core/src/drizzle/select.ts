import type {
  Assume,
  Column,
  MakeColumnConfig,
  QueryPromise,
  SelectedFields,
  SelectedFieldsOrdered,
  Subquery,
  Table,
  TableConfig,
  UpdateTableConfig,
  ValidateShape,
  entityKind,
} from "drizzle-orm";
import { TypedQueryBuilder } from "drizzle-orm/query-builders/query-builder";
import type {
  AddAliasToSelection,
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
import type {
  ColumnsSelection,
  Placeholder,
  Query,
  SQL,
  View,
} from "drizzle-orm/sql";

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.ts#L54
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.ts#L50
 */
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
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.ts#L126
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.ts#L130
 */
export abstract class SelectQueryBuilderBase<
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
> extends TypedQueryBuilder<TSelectedFields, TResult> {
  declare [entityKind]: string;
  declare _: {
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

  declare leftJoin: JoinFn<this, TDynamic, "left">;
  declare rightJoin: JoinFn<this, TDynamic, "right">;
  declare innerJoin: JoinFn<this, TDynamic, "inner">;
  declare fullJoin: JoinFn<this, TDynamic, "full">;

  private declare setOperator: <TValue extends SetOperatorWithResult<TResult>>(
    rightSelection:
      | ((
          setOperators: GetSetOperators,
        ) => SetOperatorRightSelect<TValue, TResult>)
      | SetOperatorRightSelect<TValue, TResult>,
  ) => SelectWithout<this, TDynamic, SetOperatorExcludedMethods, true>;

  declare union: typeof this.setOperator;
  declare unionAll: typeof this.setOperator;
  declare intersect: typeof this.setOperator;
  declare intersectAll: typeof this.setOperator;
  declare except: typeof this.setOperator;
  declare exceptAll: typeof this.setOperator;

  declare where: (
    where: ((aliases: TSelection) => SQL | undefined) | SQL | undefined,
  ) => SelectWithout<this, TDynamic, "where">;

  declare having: (
    having:
      | ((aliases: this["_"]["selection"]) => SQL | undefined)
      | SQL
      | undefined,
  ) => SelectWithout<this, TDynamic, "having">;

  declare groupBy: (
    ...columns: (Column | SQL)[]
  ) => SelectWithout<this, TDynamic, "groupBy">;

  declare orderBy: (
    ...columns: (Column | SQL)[]
  ) => SelectWithout<this, TDynamic, "orderBy">;

  declare limit: (
    limit: number | Placeholder,
  ) => SelectWithout<this, TDynamic, "limit">;

  declare offset: (
    offset: number | Placeholder,
  ) => SelectWithout<this, TDynamic, "offset">;

  declare toSQL: () => Query;

  declare as: <TAlias extends string>(
    alias: TAlias,
  ) => SubqueryWithSelection<this["_"]["selectedFields"], TAlias>;

  declare $dynamic: () => SelectDynamic<this>;
}

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.ts#L803
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.ts#L903
 */
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
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L52
 */
export type SelectConfig = {
  withList?: Subquery[];
  fields: Record<string, unknown>;
  fieldsFlat?: SelectedFieldsOrdered<Column>;
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
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L75
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L82
 */
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

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L106
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L111
 */
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
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L124
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L146
 */
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

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L138
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L158
 */
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

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L163
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L179
 */
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
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L179
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L193
 */
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

export type SetOperatorExcludedMethods =
  | "leftJoin"
  | "rightJoin"
  | "innerJoin"
  | "fullJoin"
  | "where"
  | "having"
  | "groupBy";

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L204
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L206
 */
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

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L227
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/query-builders/select.types.ts#L224
 */
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

export type SelectDynamic<T extends AnySelectQueryBuilder> = SelectKind<
  T["_"]["hkt"],
  T["_"]["tableName"],
  T["_"]["resultType"],
  T["_"]["runResult"],
  T["_"]["selection"],
  T["_"]["selectMode"],
  T["_"]["nullabilityMap"],
  true,
  never,
  T["_"]["result"],
  T["_"]["selectedFields"]
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

export type AnySetOperatorInterface = SetOperatorInterface<
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

export interface SetOperatorInterface<
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
  TResult extends any[] = SelectResult<
    TSelection,
    TSelectMode,
    TNullabilityMap
  >[],
  TSelectedFields extends ColumnsSelection = BuildSubquerySelection<
    TSelection,
    TNullabilityMap
  >,
> {
  _: {
    readonly hkt: SelectHKTBase;
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
}

export type SetOperatorWithResult<TResult extends any[]> = SetOperatorInterface<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  TResult,
  any
>;

export type SetOperatorRightSelect<
  TValue extends SetOperatorWithResult<TResult>,
  TResult extends any[],
> = TValue extends SetOperatorInterface<
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  any,
  infer TValueResult,
  any
>
  ? ValidateShape<
      TValueResult[number],
      TResult[number],
      TypedQueryBuilder<any, TValueResult>
    >
  : TValue;

export type SetOperatorRestSelect<
  TValue extends readonly SetOperatorWithResult<TResult>[],
  TResult extends any[],
> = TValue extends [infer First, ...infer Rest]
  ? First extends SetOperatorInterface<
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      any,
      infer TValueResult,
      any
    >
    ? Rest extends AnySetOperatorInterface[]
      ? [
          ValidateShape<
            TValueResult[number],
            TResult[number],
            TypedQueryBuilder<any, TValueResult>
          >,
          ...SetOperatorRestSelect<Rest, TResult>,
        ]
      : ValidateShape<
          TValueResult[number],
          TResult[number],
          TypedQueryBuilder<any, TValueResult>[]
        >
    : never
  : TValue;

export type CreateSetOperatorFn = <
  TTableName extends string | undefined,
  TResultType extends "sync" | "async",
  TRunResult,
  TSelection extends ColumnsSelection,
  TValue extends SetOperatorWithResult<TResult>,
  TRest extends SetOperatorWithResult<TResult>[],
  TSelectMode extends SelectMode = "single",
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
>(
  leftSelect: SetOperatorInterface<
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
  rightSelect: SetOperatorRightSelect<TValue, TResult>,
  ...restSelects: SetOperatorRestSelect<TRest, TResult>
) => SelectWithout<
  SelectBase<
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
  false,
  SetOperatorExcludedMethods,
  true
>;

export type GetSetOperators = {
  union: CreateSetOperatorFn;
  intersect: CreateSetOperatorFn;
  except: CreateSetOperatorFn;
  unionAll: CreateSetOperatorFn;
};

export type SubqueryWithSelection<
  TSelection extends ColumnsSelection,
  TAlias extends string,
> = Subquery<TAlias, AddAliasToSelection<TSelection, TAlias, "sqlite">> &
  AddAliasToSelection<TSelection, TAlias, "sqlite">;

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/table.ts#L49
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/table.ts#L43
 */
export type TableWithColumns<T extends TableConfig> = Table<T> & {
  [key in keyof T["columns"]]: T["columns"][key];
};

/**
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/sqlite-core/view.ts#L154
 * https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/view.ts#L305
 */
export type ViewWithSelection<
  TName extends string,
  TExisting extends boolean,
  TSelection extends ColumnsSelection,
> = View<TName, TExisting, TSelection> & TSelection;
