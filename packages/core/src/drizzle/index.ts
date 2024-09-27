import type { Database } from "@/database/index.js";
import {
  type DrizzleConfig,
  type ExtractTablesWithRelations,
  Param,
  type RelationalSchemaConfig,
  SQL,
  type Subquery,
  Table,
  type TablesRelationalConfig,
  type UpdateSet,
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  getTableColumns,
  is,
} from "drizzle-orm";
import {
  NodePgDriver,
  type NodePgQueryResultHKT,
} from "drizzle-orm/node-postgres";
import {
  PgDialect,
  type PgInsertConfig,
  type PgInsertValue,
  type PgQueryResultHKT,
  type PgSession,
  type PgTable,
  type PgUpdateSetSource,
  PgDatabase as _PgDatabase,
  PgDeleteBase as _PgDeleteBase,
  PgInsertBase as _PgInsertBase,
  PgInsertBuilder as _PgInsertBuilder,
  PgUpdateBase as _PgUpdateBase,
  PgUpdateBuilder as _PgUpdateBuilder,
} from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { getReorgTable } from "./sql.js";

export const onchain = Symbol.for("ponder:onchain");

export type Drizzle<
  TSchema extends Record<string, unknown> = Record<string, never>,
> = PgDatabase<NodePgQueryResultHKT, TSchema>;

export type Schema = { [name: string]: unknown };

export const createDrizzleDb = <
  TSchema extends Record<string, unknown> = Record<string, never>,
>(
  database: Pick<Database, "driver">,
  config: DrizzleConfig<TSchema> = {},
): Drizzle<TSchema> => {
  const dialect = new PgDialect();

  let schema: RelationalSchemaConfig<TablesRelationalConfig> | undefined;
  if (config.schema) {
    const tablesConfig = extractTablesRelationalConfig(
      config.schema,
      createTableRelationsHelpers,
    );
    schema = {
      fullSchema: config.schema,
      schema: tablesConfig.tables,
      tableNamesMap: tablesConfig.tableNamesMap,
    };
  }

  const driver = new NodePgDriver(database.driver.user as Pool, dialect);
  const session = driver.createSession(schema);
  return new PgDatabase(dialect, session, schema) as Drizzle<TSchema>;
};

class PgDatabase<
  TQueryResult extends PgQueryResultHKT,
  TFullSchema extends Record<string, unknown> = Record<string, never>,
  TSchema extends
    TablesRelationalConfig = ExtractTablesWithRelations<TFullSchema>,
> extends _PgDatabase<TQueryResult, TFullSchema, TSchema> {
  checkpoint: string | undefined;
  mode: "historical" | "realtime";

  constructor(
    /** @internal */
    readonly dialect: PgDialect,
    /** @internal */
    readonly session: PgSession<any, any, any>,
    schema: RelationalSchemaConfig<TSchema> | undefined,
  ) {
    super(dialect, session, schema);
    this.mode = "historical";
  }

  override insert<TTable extends PgTable>(
    table: TTable,
  ): _PgInsertBuilder<TTable, TQueryResult> {
    return this.mode === "historical" || !(onchain in table)
      ? super.insert(table)
      : new PgInsertBuilder(
          this.checkpoint!,
          table,
          this.session,
          this.dialect,
        );
  }

  override update<TTable extends PgTable>(
    table: TTable,
  ): _PgUpdateBuilder<TTable, TQueryResult> {
    return this.mode === "historical" || !(onchain in table)
      ? super.update(table)
      : new PgUpdateBuilder(
          this.checkpoint!,
          table,
          this.session,
          this.dialect,
        );
  }

  override delete<TTable extends PgTable>(
    table: TTable,
  ): _PgDeleteBase<TTable, TQueryResult> {
    // @ts-ignore
    return this.mode === "historical" || !(onchain in table)
      ? super.delete(table)
      : new PgDeleteBase(this.checkpoint!, table, this.session, this.dialect);
  }
}

class PgInsertBuilder<
  TTable extends PgTable,
  TQueryResult extends PgQueryResultHKT,
> extends _PgInsertBuilder<TTable, TQueryResult> {
  constructor(
    private checkpoint: string,
    table: TTable,
    session: PgSession,
    dialect: PgDialect,
    withList?: Subquery[],
  ) {
    super(table, session, dialect, withList);
  }

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
      this.checkpoint,
      // @ts-ignore
      this.table,
      mappedValues,
      // @ts-ignore
      this.session,
      // @ts-ignore
      this.dialect,
      // @ts-ignore
      this.withList,
    );
  }
}

class PgUpdateBuilder<
  TTable extends PgTable,
  TQueryResult extends PgQueryResultHKT,
> extends _PgUpdateBuilder<TTable, TQueryResult> {
  constructor(
    private checkpoint: string,
    table: TTable,
    session: PgSession,
    dialect: PgDialect,
    withList?: Subquery[],
  ) {
    super(table, session, dialect, withList);
  }

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
      this.checkpoint,
      // @ts-ignore
      this.table,
      Object.fromEntries(entries),
      // @ts-ignore
      this.session,
      // @ts-ignore
      this.dialect,
      // @ts-ignore
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
  constructor(
    private checkpoint: string,
    table: TTable,
    values: PgInsertConfig["values"],
    session: PgSession,
    dialect: PgDialect,
    withList?: Subquery[],
  ) {
    super(table, values, session, dialect, withList);
  }

  override execute: ReturnType<this["prepare"]>["execute"] = async (
    placeholderValues,
  ) => {
    const operation = new Param(0);
    const checkpoint = new Param(this.checkpoint);

    // @ts-ignore
    for (const v of this.config.values) {
      v.operation = operation;
      v.checkpoint = checkpoint;
    }

    // @ts-ignore
    const table = this.config.table;
    // @ts-ignore
    this.config.table = getReorgTable(this.config.table);

    // @ts-ignore
    await this.session
      .prepareQuery(
        // @ts-ignore
        this.dialect.sqlToQuery(this.dialect.buildInsertQuery(this.config)),
      )
      .execute(placeholderValues);

    // @ts-ignore
    this.config.table = table;

    // @ts-ignore
    return this.session
      .prepareQuery(
        // @ts-ignore
        this.dialect.sqlToQuery(this.getSQL()),
        // @ts-ignore
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
  constructor(
    private checkpoint: string,
    table: TTable,
    set: UpdateSet,
    session: PgSession,
    dialect: PgDialect,
    withList?: Subquery[],
  ) {
    super(table, set, session, dialect, withList);
  }

  override execute: ReturnType<this["prepare"]>["execute"] = async (
    placeholderValues,
  ) => {
    // @ts-ignore
    this.config.fields = getTableColumns<PgTable>(this.config.table);
    // @ts-ignore
    this.config.setOperators = [];
    // @ts-ignore
    const fieldsList = Object.entries(this.config.fields).map(
      ([name, field]) => ({
        path: [name],
        field,
      }),
    );

    // @ts-ignore
    const select = await this.session
      .prepareQuery(
        // @ts-ignore
        this.dialect.sqlToQuery(this.dialect.buildSelectQuery(this.config)),
        fieldsList,
        undefined,
        true,
      )
      .execute(placeholderValues);

    const operation = new Param(1);
    const checkpoint = new Param(this.checkpoint);

    // @ts-ignore
    const values = select.map((entry) => {
      const result: Record<string, Param | SQL> = {};
      // @ts-ignore
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

    // @ts-ignore
    const table = this.config.table;
    // @ts-ignore
    this.config.table = getReorgTable(this.config.table);
    // @ts-ignore
    this.config.values = values;

    // @ts-ignore
    await this.session
      .prepareQuery(
        // @ts-ignore
        this.dialect.sqlToQuery(this.dialect.buildInsertQuery(this.config)),
      )
      .execute(placeholderValues);

    // @ts-ignore
    this.config.table = table;

    // @ts-ignore
    return this.session
      .prepareQuery(
        // @ts-ignore
        this.dialect.sqlToQuery(this.getSQL()),
        // @ts-ignore
        this.config.returning,
        undefined,
        true,
      )
      .execute(placeholderValues);
  };
}

class PgDeleteBase<
  TTable extends PgTable,
  TQueryResult extends PgQueryResultHKT,
  TReturning extends Record<string, unknown> | undefined = undefined,
  TDynamic extends boolean = false,
  TExcludedMethods extends string = never,
> extends _PgDeleteBase<
  TTable,
  TQueryResult,
  TReturning,
  TDynamic,
  TExcludedMethods
> {
  constructor(
    private checkpoint: string,
    table: TTable,
    session: PgSession,
    dialect: PgDialect,
    withList?: Subquery[],
  ) {
    super(table, session, dialect, withList);
  }

  override execute: ReturnType<this["prepare"]>["execute"] = async (
    placeholderValues,
  ) => {
    // @ts-ignore
    this.config.fields = getTableColumns<PgTable>(this.config.table);
    // @ts-ignore
    this.config.setOperators = [];
    // @ts-ignore
    const fieldsList = Object.entries(this.config.fields).map(
      ([name, field]) => ({
        path: [name],
        field,
      }),
    );

    // @ts-ignore
    const select = await this.session
      .prepareQuery(
        // @ts-ignore
        this.dialect.sqlToQuery(this.dialect.buildSelectQuery(this.config)),
        fieldsList,
        undefined,
        true,
      )
      .execute(placeholderValues);

    const operation = new Param(2);
    const checkpoint = new Param(this.checkpoint);

    // @ts-ignore
    const values = select.map((entry) => {
      const result: Record<string, Param | SQL> = {};
      // @ts-ignore
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

    // @ts-ignore
    const table = this.config.table;
    // @ts-ignore
    this.config.table = getReorgTable(this.config.table);
    // @ts-ignore
    this.config.values = values;

    // @ts-ignore
    await this.session
      .prepareQuery(
        // @ts-ignore
        this.dialect.sqlToQuery(this.dialect.buildInsertQuery(this.config)),
      )
      .execute(placeholderValues);

    // @ts-ignore
    this.config.table = table;

    // @ts-ignore
    return this.session
      .prepareQuery(
        // @ts-ignore
        this.dialect.sqlToQuery(this.getSQL()),
        // @ts-ignore
        this.config.returning,
        undefined,
        true,
      )
      .execute(placeholderValues);
  };
}
