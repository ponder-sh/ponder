import {
  type BuildColumns,
  type ColumnBuilderBase,
  Table,
  type Writable,
} from "drizzle-orm";
import {
  type AnyPgColumn,
  type PrimaryKeyBuilder as DrizzlePrimaryKeyBuilder,
  type ExtraConfigColumn,
  type PgColumnBuilder,
  type PgColumnBuilderBase,
  PgEnumColumnBuilder,
  type PgEnumColumnBuilderInitial,
  PgTable,
  type PgTableExtraConfig,
  type PgTableWithColumns,
  type PgTextConfig,
  type TableConfig,
  primaryKey as drizzlePrimaryKey,
} from "drizzle-orm/pg-core";
import {
  type PgColumnsBuilders as _PgColumnsBuilders,
  getPgColumnBuilders,
} from "drizzle-orm/pg-core/columns/all";
import { PgBigintBuilder, type PgBigintBuilderInitial } from "./bigint.js";
import { PgBytesBuilder, type PgBytesBuilderInitial } from "./bytes.js";
import { PgHexBuilder, type PgHexBuilderInitial } from "./hex.js";
import {
  PgJsonBuilder,
  type PgJsonBuilderInitial,
  PgJsonbBuilder,
  type PgJsonbBuilderInitial,
} from "./json.js";
import { PgTextBuilder, type PgTextBuilderInitial } from "./text.js";

/** @internal */
function getColumnNameAndConfig<
  TConfig extends Record<string, any> | undefined,
>(a: string | TConfig | undefined, b: TConfig | undefined) {
  return {
    name: typeof a === "string" && a.length > 0 ? a : ("" as string),
    config: typeof a === "object" ? a : (b as TConfig),
  };
}

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

export function json(): PgJsonBuilderInitial<"">;
export function json<name extends string>(
  name: name,
): PgJsonBuilderInitial<name>;
export function json(name?: string) {
  return new PgJsonBuilder(name ?? "");
}

export function jsonb(): PgJsonbBuilderInitial<"">;
export function jsonb<name extends string>(
  name: name,
): PgJsonbBuilderInitial<name>;
export function jsonb(name?: string) {
  return new PgJsonbBuilder(name ?? "");
}

// @ts-ignore
export function bytes(): PgBytesBuilderInitial<"">;
export function bytes<name extends string>(
  columnName: name,
): PgBytesBuilderInitial<name>;
export function bytes(columnName?: string) {
  return new PgBytesBuilder(columnName ?? "");
}

export function text(): PgTextBuilderInitial<"", [string, ...string[]]>;
export function text<U extends string, T extends Readonly<[U, ...U[]]>>(
  config?: PgTextConfig<T | Writable<T>>,
): PgTextBuilderInitial<"", Writable<T>>;
export function text<
  TName extends string,
  U extends string,
  T extends Readonly<[U, ...U[]]>,
>(
  name: TName,
  config?: PgTextConfig<T | Writable<T>>,
): PgTextBuilderInitial<TName, Writable<T>>;
export function text(a?: string | PgTextConfig, b: PgTextConfig = {}): any {
  const { name, config } = getColumnNameAndConfig<PgTextConfig>(a, b);
  return new PgTextBuilder(name, config as any);
}

export const onchain = Symbol.for("ponder:onchain");

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

export type BuildExtraConfigColumns<
  columns extends Record<string, ColumnBuilderBase>,
> = {
  [key in keyof columns]: ExtraConfigColumn & {
    " name": key;
  };
};

export type PgColumnsBuilders = Omit<
  _PgColumnsBuilders,
  "bigint" | "serial" | "smallserial" | "bigserial" | "json" | "jsonb"
> & {
  /**
   * Create an 8 byte number column.
   */
  int8: _PgColumnsBuilders["bigint"];
  /**
   * Create a column for hex strings.
   *
   * - Docs: https://ponder.sh/docs/api-reference/ponder/schema#onchaintable
   *
   * @example
   * import { hex, onchainTable } from "ponder";
   *
   * export const account = onchainTable("account", (p) => ({
   *   address: p.hex(),
   * }));
   */
  hex: typeof hex;
  /**
   * Create a column for Ethereum integers
   *
   * - Docs: https://ponder.sh/docs/api-reference/ponder/schema#onchaintable
   *
   * @example
   * import { bigint, onchainTable } from "ponder";
   *
   * export const account = onchainTable("account", (p) => ({
   *   balance: p.bigint(),
   * }));
   */
  bigint: typeof bigint;
  /**
   * Create a column for Ethereum bytes
   *
   * - Docs: https://ponder.sh/docs/api-reference/ponder/schema#onchaintable
   *
   * @example
   * import { bytes, onchainTable } from "ponder";
   *
   * export const account = onchainTable("account", (p) => ({
   *   calldata: p.bytes(),
   * }));
   */
  bytes: typeof bytes;
  json: typeof json;
  jsonb: typeof jsonb;
};

/**
 * Create an onchain table.
 *
 * - Docs: https://ponder.sh/docs/api-reference/ponder/schema#onchaintable
 *
 * @example
 * import { onchainTable } from "ponder";
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
  const schema = globalThis?.PONDER_NAMESPACE_BUILD?.schema;
  const table = pgTableWithSchema(name, columns, extraConfig as any, schema);

  // @ts-ignore
  table[onchain] = true;

  // @ts-ignore
  return table;
};

export const isPgEnumSym = Symbol.for("drizzle:isPgEnum");

export type OnchainEnum<TValues extends [string, ...string[]]> = {
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
} & { [onchain]: true };

export const onchainEnum = <U extends string, T extends Readonly<[U, ...U[]]>>(
  enumName: string,
  values: T | Writable<T>,
): OnchainEnum<Writable<T>> => {
  const schema = globalThis?.PONDER_NAMESPACE_BUILD?.schema;
  const e = pgEnumWithSchema(enumName, values, schema);

  // @ts-ignore
  e[onchain] = true;

  // @ts-ignore
  return e;
};

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

  const { bigint: int8, text: _text, ...restColumns } = getPgColumnBuilders();

  const parsedColumns: columns =
    typeof columns === "function"
      ? columns({ ...restColumns, int8, hex, bigint, bytes, text, json, jsonb })
      : columns;

  const builtColumns = Object.fromEntries(
    Object.entries(parsedColumns).map(([name, colBuilderBase]) => {
      const colBuilder = colBuilderBase;
      // @ts-ignore
      colBuilder.setName(name);
      // @ts-ignore
      const column = colBuilder.build(rawTable);
      // @ts-ignore
      rawTable[Symbol.for("drizzle:PgInlineForeignKeys")].push(
        // @ts-ignore
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
      [onchain]: true,
    } as const,
  );

  return enumInstance;
}
