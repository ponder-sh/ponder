import {
  type BuildColumns,
  type ColumnBuilderBase,
  Table,
  type Writable,
  getTableColumns,
  getTableName,
  is,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  type AnyPgColumn,
  type PrimaryKeyBuilder as DrizzlePrimaryKeyBuilder,
  type ExtraConfigColumn,
  type PgColumn,
  type PgColumnBuilder,
  type PgColumnBuilderBase,
  PgEnumColumnBuilder,
  type PgEnumColumnBuilderInitial,
  PgSchema,
  PgTable,
  type PgTableExtraConfig,
  type PgTableWithColumns,
  type TableConfig,
  primaryKey as drizzlePrimaryKey,
  getTableConfig,
} from "drizzle-orm/pg-core";
import {
  type PgColumnsBuilders as _PgColumnsBuilders,
  getPgColumnBuilders,
} from "drizzle-orm/pg-core/columns/all";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { PgBigintBuilder, type PgBigintBuilderInitial } from "./bigint.js";
import { PgHexBuilder, type PgHexBuilderInitial } from "./hex.js";
import { getColumnCasing } from "./kit/index.js";

// @ts-ignore
export function hex(): PgHexBuilderInitial<"">;
export function hex<name extends string>(
  columnName: name,
): PgHexBuilderInitial<name>;
export function hex(columnName?: string) {
  return new PgHexBuilder(columnName ?? "");
}

// @ts-ignore
export function bigint(): PgBigintBuilderInitial<"">;
export function bigint<name extends string>(
  columnName: name,
): PgBigintBuilderInitial<name>;
export function bigint(columnName?: string) {
  return new PgBigintBuilder(columnName ?? "");
}

export const onchain = Symbol.for("ponder:onchain");

export type Drizzle<TSchema extends Schema = { [name: string]: never }> =
  | NodePgDatabase<TSchema>
  | PgliteDatabase<TSchema>;

export type Schema = { [name: string]: unknown };

export const userToSqlTableName = (tableName: string, instanceId: string) =>
  `${instanceId}__${tableName}`;

export const sqlToUserTableName = (tableName: string) => tableName.slice(6);

export const userToReorgTableName = (tableName: string, instanceId: string) =>
  `${instanceId}_reorg__${tableName}`;

export const getTableNames = (schema: Schema, instanceId: string) => {
  const tableNames = Object.entries(schema)
    .filter(([, table]) => is(table, PgTable))
    .map(([js, table]) => {
      const tableName = getTableName(table as PgTable);
      const user = sqlToUserTableName(tableName);

      return {
        user,
        sql: userToSqlTableName(user, instanceId),
        reorg: userToReorgTableName(user, instanceId),
        trigger: userToReorgTableName(user, instanceId),
        triggerFn: `operation_${instanceId}_reorg__${user}()`,
        js,
      } as const;
    });

  return tableNames;
};

export const getPrimaryKeyColumns = (
  table: PgTable,
): { sql: string; js: string }[] => {
  const primaryKeys = getTableConfig(table).primaryKeys;

  const findJsName = (column: PgColumn): string => {
    const name = column.name;
    for (const [js, column] of Object.entries(getTableColumns(table))) {
      if (column.name === name) return js;
    }

    throw "unreachable";
  };

  if (primaryKeys.length > 0) {
    return primaryKeys[0]!.columns.map((column) => ({
      sql: getColumnCasing(column, "snake_case"),
      js: findJsName(column),
    }));
  }

  const pkColumn = Object.values(getTableColumns(table)).find(
    (c) => c.primary,
  )!;

  return [
    {
      sql: getColumnCasing(pkColumn, "snake_case"),
      js: findJsName(pkColumn),
    },
  ];
};

export type PrimaryKeyBuilder<columnNames extends string = string> =
  DrizzlePrimaryKeyBuilder & { columnNames: columnNames };

export const primaryKey = <
  tableName extends string,
  column extends AnyPgColumn<{ tableName: tableName }> & { " name": string },
  columns extends (AnyPgColumn<{ tableName: tableName }> & {
    " name": string;
  })[],
>({
  name,
  columns,
}: { name?: string; columns: [column, ...columns] }) =>
  drizzlePrimaryKey({ name, columns }) as PrimaryKeyBuilder<
    column[" name"] | columns[number][" name"]
  >;

export type OnchainTable<
  T extends TableConfig & {
    extra: PgTableExtraConfig | undefined;
  } = TableConfig & { extra: PgTableExtraConfig | undefined },
> = PgTable<T> & {
  [Key in keyof T["columns"]]: T["columns"][Key];
} & { [onchain]: true } & {
  enableRLS: () => Omit<OnchainTable<T>, "enableRLS">;
};

type BuildExtraConfigColumns<
  columns extends Record<string, ColumnBuilderBase>,
> = {
  [key in keyof columns]: ExtraConfigColumn & {
    " name": key;
  };
};

type PgColumnsBuilders = Omit<
  _PgColumnsBuilders,
  "bigint" | "serial" | "smallserial" | "bigserial"
> & {
  /**
   * Create an 8 byte number column.
   */
  int8: _PgColumnsBuilders["bigint"];
  /**
   * Create a column for hex strings.
   *
   * - Docs: https://ponder.sh/docs/api-reference/schema#onchaintable
   *
   * @example
   * import { hex, onchainTable } from "@ponder/core";
   *
   * export const account = onchainTable("account", (p) => ({
   *   address: p.hex(),
   * }));
   */
  hex: typeof hex;
  /**
   * Create a column for hex strings
   *
   * - Docs: https://ponder.sh/docs/api-reference/schema#onchaintable
   *
   * @example
   * import { hex, onchainTable } from "@ponder/core";
   *
   * export const account = onchainTable("account", (p) => ({
   *   balance: p.bigint(),
   * }));
   */
  bigint: typeof bigint;
};
/**
 * Create an onchain table.
 *
 * - Docs: https://ponder.sh/docs/api-reference/schema#onchaintable
 *
 * @example
 * import { onchainTable } from "@ponder/core";
 *
 * export const account = onchainTable("account", (p) => ({
 *   address: p.hex().primaryKey(),
 *   balance: p.bigint().notNull(),
 * }));
 *
 * @param name - The table name in the database.
 * @param columns - The table columns.
 * @param extra - Config such as indexes or composite primary keys.
 * @returns The onchain table.
 */
export const onchainTable = <
  name extends string,
  columns extends Record<string, PgColumnBuilderBase>,
  extra extends PgTableExtraConfig | undefined = undefined,
>(
  name: name,
  columns: columns | ((columnTypes: PgColumnsBuilders) => columns),
  extraConfig?: (self: BuildExtraConfigColumns<columns>) => extra,
): OnchainTable<{
  name: name;
  schema: undefined;
  columns: BuildColumns<name, columns, "pg">;
  extra: extra;
  dialect: "pg";
}> => {
  const instanceId: string | undefined =
    process.env.PONDER_EXPERIMENTAL_INSTANCE_ID ??
    // @ts-ignore
    globalThis.__PONDER_INSTANCE_ID;
  if (instanceId === undefined) {
    const table = pgTableWithSchema(
      name,
      columns,
      extraConfig as any,
      undefined,
    );

    // @ts-ignore
    table[onchain] = true;

    // @ts-ignore
    return table;
  }

  const table = pgTableWithSchema(
    userToSqlTableName(name, instanceId),
    columns,
    extraConfig as any,
    undefined,
  );

  // @ts-ignore
  table[onchain] = true;

  // @ts-ignore
  return table;
};

class OnchainSchema<schema extends string> extends PgSchema<schema> {
  override table = <
    name extends string,
    columns extends Record<string, PgColumnBuilderBase>,
    extra extends PgTableExtraConfig | undefined = undefined,
  >(
    name: name,
    columns: columns | ((columnTypes: PgColumnsBuilders) => columns),
    extraConfig?: (self: BuildExtraConfigColumns<columns>) => extra,
  ): OnchainTable<{
    name: name;
    schema: schema;
    columns: BuildColumns<name, columns, "pg">;
    extra: extra;
    dialect: "pg";
  }> => {
    const instanceId: string | undefined =
      process.env.PONDER_EXPERIMENTAL_INSTANCE_ID ??
      // @ts-ignore
      globalThis.__PONDER_INSTANCE_ID;
    if (instanceId === undefined) {
      const table = pgTableWithSchema(
        name,
        columns,
        extraConfig as any,
        this.schemaName,
      );

      // @ts-ignore
      table[onchain] = true;

      // @ts-ignore
      return table;
    }

    const table = pgTableWithSchema(
      // @ts-ignore
      userToSqlTableName(name, instanceId),
      columns,
      extraConfig as any,
      this.schemaName,
    );

    // @ts-ignore
    table[onchain] = true;

    // @ts-ignore
    return table;
  };

  override enum = <U extends string, T extends Readonly<[U, ...U[]]>>(
    enumName: string,
    values: T | Writable<T>,
  ): OnchainEnum<Writable<T>> & { [onchain]: true } => {
    const instanceId: string | undefined =
      process.env.PONDER_EXPERIMENTAL_INSTANCE_ID ??
      // @ts-ignore
      globalThis.__PONDER_INSTANCE_ID;
    if (instanceId === undefined) {
      const e = pgEnumWithSchema(enumName, values, this.schemaName);

      // @ts-ignore
      e[onchain] = true;

      // @ts-ignore
      return e;
    }

    const e = pgEnumWithSchema(
      userToSqlTableName(enumName, instanceId),
      values,
      this.schemaName,
    );

    // @ts-ignore
    e[onchain] = true;

    // @ts-ignore
    return e;
  };
}

/**
 * Define the database schema for onchain tables.
 *
 * @example
 * import { onchainSchema } from "@ponder/core";
 *
 * export const schema = onchainSchema("ponder");
 *
 * export const account = schema.table("account", (p) => ({
 *   address: p.hex().primaryKey(),
 *   balance: p.bigint().notNull(),
 * }));
 *
 * @param name - The schema for onchain tables.
 * @returns The onchain schema.
 */
export const onchainSchema = <T extends string>(name: T) =>
  new OnchainSchema(name);

export const isPgEnumSym = Symbol.for("drizzle:isPgEnum");

export interface OnchainEnum<TValues extends [string, ...string[]]> {
  (): PgEnumColumnBuilderInitial<"", TValues>;
  <TName extends string>(
    name: TName,
  ): PgEnumColumnBuilderInitial<TName, TValues>;
  <TName extends string>(
    name?: TName,
  ): PgEnumColumnBuilderInitial<TName, TValues>;

  readonly enumName: string;
  readonly enumValues: TValues;
  readonly schema: string | undefined;
  /** @internal */
  [isPgEnumSym]: true;
}

export const onchainEnum = <U extends string, T extends Readonly<[U, ...U[]]>>(
  enumName: string,
  values: T | Writable<T>,
): OnchainEnum<Writable<T>> & { [onchain]: true } => {
  // @ts-ignore
  const instanceId: string | undefined = globalThis.__PONDER_INSTANCE_ID;
  if (instanceId === undefined) {
    const e = pgEnumWithSchema(enumName, values, undefined);

    // @ts-ignore
    e[onchain] = true;

    // @ts-ignore
    return e;
  }

  const e = pgEnumWithSchema(
    // @ts-ignore
    userToSqlTableName(enumName, instanceId),
    values,
    undefined,
  );

  // @ts-ignore
  e[onchain] = true;

  // @ts-ignore
  return e;
};

const InlineForeignKeys = Symbol.for("drizzle:PgInlineForeignKeys");

/** @see https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/table.ts#L51 */
function pgTableWithSchema<
  name extends string,
  schema extends string | undefined,
  columns extends Record<string, PgColumnBuilderBase>,
>(
  name: name,
  columns: columns | ((columnTypes: PgColumnsBuilders) => columns),
  extraConfig:
    | ((self: BuildExtraConfigColumns<columns>) => PgTableExtraConfig)
    | undefined,
  schema: schema,
  baseName = name,
): PgTableWithColumns<{
  name: name;
  schema: schema;
  columns: BuildColumns<name, columns, "pg">;
  dialect: "pg";
}> {
  const rawTable = new PgTable<{
    name: name;
    schema: schema;
    columns: BuildColumns<name, columns, "pg">;
    dialect: "pg";
  }>(name, schema, baseName);

  const { bigint: int8, ...restColumns } = getPgColumnBuilders();

  const parsedColumns: columns =
    typeof columns === "function"
      ? columns({ ...restColumns, int8, hex, bigint })
      : columns;

  const builtColumns = Object.fromEntries(
    Object.entries(parsedColumns).map(([name, colBuilderBase]) => {
      const colBuilder = colBuilderBase;
      //@ts-ignore
      colBuilder.setName(name);
      //@ts-ignore
      const column = colBuilder.build(rawTable);
      // @ts-ignore
      rawTable[InlineForeignKeys].push(
        //@ts-ignore
        ...colBuilder.buildForeignKeys(column, rawTable),
      );
      return [name, column];
    }),
  ) as unknown as BuildColumns<name, columns, "pg">;

  const builtColumnsForExtraConfig = Object.fromEntries(
    Object.entries(parsedColumns).map(([name, colBuilderBase]) => {
      const colBuilder = colBuilderBase as PgColumnBuilder;
      //@ts-ignore
      colBuilder.setName(name);
      //@ts-ignore
      const column = colBuilder.buildExtraConfigColumn(rawTable);
      return [name, column];
    }),
  ) as unknown as BuildExtraConfigColumns<columns>;

  const table = Object.assign(rawTable, builtColumns);

  //@ts-ignore
  table[Table.Symbol.Columns] = builtColumns;
  //@ts-ignore
  table[Table.Symbol.ExtraConfigColumns] = builtColumnsForExtraConfig;

  if (extraConfig) {
    //@ts-ignore
    table[PgTable.Symbol.ExtraConfigBuilder] = extraConfig as any;
  }

  return Object.assign(table, {
    enableRLS: () => {
      // @ts-ignore
      table[PgTable.Symbol.EnableRLS] = true;
      return table as PgTableWithColumns<{
        name: name;
        schema: schema;
        columns: BuildColumns<name, columns, "pg">;
        dialect: "pg";
      }>;
    },
  });
}

function pgEnumWithSchema<U extends string, T extends Readonly<[U, ...U[]]>>(
  enumName: string,
  values: T | Writable<T>,
  schema?: string,
): OnchainEnum<Writable<T>> {
  const enumInstance: OnchainEnum<Writable<T>> = Object.assign(
    <TName extends string>(
      name?: TName,
    ): PgEnumColumnBuilderInitial<TName, Writable<T>> =>
      new PgEnumColumnBuilder(name ?? ("" as TName), enumInstance),
    {
      enumName,
      enumValues: values,
      schema,
      [isPgEnumSym]: true,
    } as const,
  );

  return enumInstance;
}
