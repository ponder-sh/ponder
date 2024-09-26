import type { Database } from "@/database/index.js";
import { encodeCheckpoint, zeroCheckpoint } from "@/utils/checkpoint.js";
import {
  type DrizzleConfig,
  type ExtractTablesWithRelations,
  Param,
  type RelationalSchemaConfig,
  SQL,
  Table,
  type TablesRelationalConfig,
  type UpdateSet,
  getTableColumns,
  is,
} from "drizzle-orm";
import {
  NodePgDriver,
  type NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import {
  type PgDeleteBase,
  PgDialect,
  type PgInsertValue,
  type PgQueryResultHKT,
  type PgSession,
  type PgTable,
  type PgUpdateSetSource,
  PgDatabase as _PgDatabase,
  PgInsertBase as _PgInsertBase,
  PgInsertBuilder as _PgInsertBuilder,
  PgUpdateBase as _PgUpdateBase,
  PgUpdateBuilder as _PgUpdateBuilder,
  numeric,
} from "drizzle-orm/pg-core";
import {} from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { PgHexBuilder, type PgHexBuilderInitial } from "./hex.js";
import { getReorgTable } from "./sql.js";

export const ponderHex = <name extends string>(
  columnName: name,
): PgHexBuilderInitial<name> => new PgHexBuilder(columnName);
export const ponderBigint = <name extends string>(columnName: name) =>
  numeric<name>(columnName, { precision: 78 }).$type<bigint>();

export type Drizzle<
  TSchema extends Record<string, unknown> = Record<string, never>,
> = PgDatabase<NodePgQueryResultHKT, TSchema>;

export type Schema = { [name: string]: unknown };

export const createDrizzleDb = <
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  database: Pick<Database, "driver">,
  _config: DrizzleConfig<TSchema> = {},
): Drizzle<TSchema> => {
  const dialect = new PgDialect();

  // TODO(kyle) include schema for relational queries

  const driver = new NodePgDriver(database.driver.user as Pool, dialect);
  const session = driver.createSession(undefined);
  return new PgDatabase(dialect, session, undefined);
};

class PgDatabase<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown> = Record<string, never>,
  TSchema extends
    TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>,
> extends _PgDatabase<TQueryResult, TFullSchema, TSchema> {
  constructor(
    // getRuntimeinfo() => {isRealtime}
    /** @internal */
    readonly dialect: PgDialect,
    /** @internal */
    readonly session: PgSession<any, any, any>,
    schema: RelationalSchemaConfig<TSchema> | undefined,
  ) {
    super(dialect, session, schema);
  }

  override insert<TTable extends PgTable>(
    table: TTable,
  ): PgInsertBuilder<TTable, TQueryResult> {
    return new PgInsertBuilder(table, this.session, this.dialect);
  }

  override update<TTable extends PgTable>(
    table: TTable,
  ): PgUpdateBuilder<TTable, TQueryResult> {
    return new PgUpdateBuilder(table, this.session, this.dialect);
  }

  override delete<TTable extends PgTable>(
    table: TTable,
  ): PgDeleteBase<TTable, TQueryResult> {
    return super.delete(table);
  }
}

class PgInsertBuilder<
  TTable extends PgTable,
  TQueryResult extends PgQueryResultHKT,
> extends _PgInsertBuilder<TTable, TQueryResult> {
  override values(
    value: PgInsertValue<TTable>,
  ): PgInsertBase<TTable, TQueryResult>;
  override values(
    values: PgInsertValue<TTable>[],
  ): PgInsertBase<TTable, TQueryResult>;
  override values(
    values: PgInsertValue<TTable> | PgInsertValue<TTable>[],
  ): PgInsertBase<TTable, TQueryResult> {
    values = Array.isArray(values) ? values : [values];
    if (values.length === 0) {
      throw new Error("values() must be called with at least one value");
    }
    const mappedValues = values.map((entry) => {
      const result: Record<string, Param | SQL> = {};
      // @ts-ignore
      const cols = this.table[Table.Symbol.Columns];
      for (const colKey of Object.keys(entry)) {
        const colValue = entry[colKey as keyof typeof entry];
        result[colKey] = is(colValue, SQL)
          ? colValue
          : new Param(colValue, cols[colKey]);
      }
      return result;
    });

    return new PgInsertBase(
      this.table,
      mappedValues,
      this.session,
      this.dialect,
      this.withList,
    );
  }
}

class PgUpdateBuilder<
  TTable extends PgTable,
  TQueryResult extends PgQueryResultHKT,
> extends _PgUpdateBuilder<TTable, TQueryResult> {
  override set(
    values: PgUpdateSetSource<TTable>,
  ): PgUpdateBase<TTable, TQueryResult> {
    const entries: [string, UpdateSet[string]][] = Object.entries(values)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        if (is(value, SQL)) {
          return [key, value];
        } else {
          // @ts-ignore
          return [key, new Param(value, this.table[Table.Symbol.Columns][key])];
        }
      });

    if (entries.length === 0) {
      throw new Error("No values to set");
    }

    return new PgUpdateBase<TTable, TQueryResult>(
      this.table,
      Object.fromEntries(entries),
      this.session,
      this.dialect,
      this.withList,
    );
  }
}

class PgInsertBase<
  TTable extends PgTable,
  TQueryResult extends PgQueryResultHKT,
  TReturning extends Record<string, unknown> | undefined = undefined,
  TDynamic extends boolean = false,
  TExcludedMethods extends string = never,
> extends _PgInsertBase<
  TTable,
  TQueryResult,
  TReturning,
  TDynamic,
  TExcludedMethods
> {
  override execute: ReturnType<this["prepare"]>["execute"] = async (
    placeholderValues,
  ) => {
    const operation = new Param(0);
    const checkpoint = new Param(encodeCheckpoint(zeroCheckpoint));

    for (const v of this.config.values) {
      v.operation = operation;
      v.checkpoint = checkpoint;
    }

    const table = this.config.table;
    this.config.table = getReorgTable(this.config.table);

    await this.session
      .prepareQuery(
        this.dialect.sqlToQuery(this.dialect.buildInsertQuery(this.config)),
      )
      .execute(placeholderValues);

    this.config.table = table;

    return this.session
      .prepareQuery(
        this.dialect.sqlToQuery(this.getSQL()),
        this.config.returning,
        undefined,
        true,
      )
      .execute(placeholderValues);
  };
}

class PgUpdateBase<
  TTable extends PgTable,
  TQueryResult extends PgQueryResultHKT,
  TReturning extends Record<string, unknown> | undefined = undefined,
  TDynamic extends boolean = false,
  TExcludedMethods extends string = never,
> extends _PgUpdateBase<
  TTable,
  TQueryResult,
  TReturning,
  TDynamic,
  TExcludedMethods
> {
  override execute: ReturnType<this["prepare"]>["execute"] = async (
    placeholderValues,
  ) => {
    this.config.fields = getTableColumns<PgTable>(this.config.table);
    this.config.setOperators = [];
    const fieldsList = Object.entries(this.config.fields).map(
      ([name, field]) => ({
        path: [name],
        field,
      }),
    );

    const select = await this.session
      .prepareQuery(
        this.dialect.sqlToQuery(this.dialect.buildSelectQuery(this.config)),
        fieldsList,
        undefined,
        true,
      )
      .execute(placeholderValues);

    const operation = new Param(1);
    const checkpoint = new Param(encodeCheckpoint(zeroCheckpoint));

    const values = select.map((entry) => {
      const result: Record<string, Param | SQL> = {};
      const cols = this.config.table[Table.Symbol.Columns];
      for (const colKey of Object.keys(entry)) {
        const colValue = entry[colKey as keyof typeof entry];
        result[colKey] = is(colValue, SQL)
          ? colValue
          : new Param(colValue, cols[colKey]);
      }
      result.operation = operation;
      result.checkpoint = checkpoint;

      return result;
    });

    const table = this.config.table;
    this.config.table = getReorgTable(this.config.table);
    this.config.values = values;

    await this.session
      .prepareQuery(
        this.dialect.sqlToQuery(this.dialect.buildInsertQuery(this.config)),
      )
      .execute(placeholderValues);

    this.config.table = table;

    return this.session
      .prepareQuery(
        this.dialect.sqlToQuery(this.getSQL()),
        this.config.returning,
        undefined,
        true,
      )
      .execute(placeholderValues);
  };
}
