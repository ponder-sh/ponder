import {
  type BuildColumns,
  type ColumnBuilderBase,
  getTableName,
  Table,
  type Writable,
} from "drizzle-orm";
import { toSnakeCase } from "drizzle-orm/casing";
import {
  type AnyPgColumn,
  type PrimaryKeyBuilder as DrizzlePrimaryKeyBuilder,
  primaryKey as drizzlePrimaryKey,
  type ExtraConfigColumn,
  ManualViewBuilder,
  type PgColumnBuilder,
  type PgColumnBuilderBase,
  PgEnumColumnBuilder,
  type PgEnumColumnBuilderInitial,
  PgTable,
  type PgTableExtraConfig,
  type PgTableWithColumns,
  type PgTextConfig,
  type TableConfig,
  ViewBuilder,
} from "drizzle-orm/pg-core";
import {
  type PgColumnsBuilders as _PgColumnsBuilders,
  getPgColumnBuilders,
} from "drizzle-orm/pg-core/columns/all";
import type { PonderTypeError } from "@/types/utils.js";
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

// 16 digits for chain ID.
export const MAX_DATABASE_OBJECT_NAME_LENGTH = 45;

// Note: All of these database object names should be less than 63 characters, otherwise they will
// be truncated by postgres.

export const getLiveQueryTriggerName = () => {
  return "live_query";
};
export const getLiveQueryProcedureName = () => {
  return "live_query()";
};
export const getLiveQueryChannelName = (schema: string) => {
  return `${schema}_live_query`;
};
export const getLiveQueryNotifyTriggerName = () => {
  return "live_query_notify";
};
/**
 * Returns the name of the trigger used to notify live queries for the views pattern.
 * @dev The trigger is placed in the base schema, but used to notify in the views schema.
 */
export const getViewsLiveQueryNotifyTriggerName = (viewsSchema: string) => {
  return `${viewsSchema}_live_query_notify`;
};
export const getLiveQueryNotifyProcedureName = () => {
  return "live_query_notify()";
};
export const getLiveQueryTempTableName = () => {
  return "live_query_tables";
};
export const getLiveQueryNotifyProcedureSql = ({
  schema,
  channel,
}: {
  schema: string;
  channel: string;
}) => {
  const tempTableName = getLiveQueryTempTableName();

  return `
CREATE OR REPLACE FUNCTION "${schema}".${getLiveQueryNotifyProcedureName()}
RETURNS TRIGGER LANGUAGE plpgsql
AS $$
  DECLARE
    current_payload text := '[';
    separator text := '';
    entry text;
    entry_json text;
  BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = '${tempTableName}'
      AND table_type = 'LOCAL TEMPORARY'
    ) THEN
      RETURN NULL;
    END IF;

    FOR entry IN SELECT table_name FROM ${tempTableName} ORDER BY table_name LOOP
      entry_json := to_json(entry)::text;

      IF current_payload <> '[' AND octet_length(current_payload) + octet_length(separator) + octet_length(entry_json) + 1 >= 7900 THEN
        PERFORM pg_notify('${channel}', current_payload || ']');
        current_payload := '[' || entry_json;
        separator := ',';
      ELSE
        current_payload := current_payload || separator || entry_json;
        separator := ',';
      END IF;
    END LOOP;

    IF current_payload = '[' THEN
      PERFORM pg_notify('${channel}', '[]');
    ELSE
      PERFORM pg_notify('${channel}', current_payload || ']');
    END IF;

    RETURN NULL;
  END;
$$;`;
};
export const getPartitionName = (table: string | PgTable, chainId: number) => {
  return `${typeof table === "string" ? table : getTableName(table)}_${chainId}`;
};
export const getReorgTableName = (table: string | PgTable) => {
  return `_reorg__${typeof table === "string" ? table : getTableName(table)}`;
};
export const getReorgTriggerName = () => {
  return "reorg";
};
export const getReorgProcedureName = (table: string | PgTable) => {
  return `operation_reorg__${typeof table === "string" ? table : getTableName(table)}()`;
};
export const getReorgSequenceName = () => {
  return "operation_id";
};

/** @internal */
function getColumnNameAndConfig<
  TConfig extends Record<string, any> | undefined,
>(a: string | TConfig | undefined, b: TConfig | undefined) {
  return {
    name: typeof a === "string" && a.length > 0 ? a : ("" as string),
    config: typeof a === "object" ? a : (b as TConfig),
  };
}

// @ts-expect-error
export function hex(): PgHexBuilderInitial<"">;
export function hex<name extends string>(
  columnName: name,
): PgHexBuilderInitial<name>;
export function hex(columnName?: string) {
  return new PgHexBuilder(columnName ?? "");
}

// @ts-expect-error
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

// @ts-expect-error
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
}: {
  name?: string;
  columns: [column, ...columns];
}) =>
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
  name: name extends "" ? PonderTypeError<`Table name cannot be empty`> : name,
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

  // @ts-expect-error
  table[onchain] = true;

  // @ts-expect-error
  return table;
};

/**
 * Create an onchain view.
 *
 * - Docs: https://ponder.sh/docs/api-reference/ponder/schema#onchainview
 *
 * @example
 * import { onchainView } from "ponder";
 *
 * export const accountView = onchainView("account_view").as((qb) =>
 *   qb.select().from(account),
 * );
 *
 * @param name - The view name in the database.
 * @param columns - [Optional] The view columns.
 * @returns The onchain view.
 */
export function onchainView<TName extends string>(
  name: TName,
): ViewBuilder<TName>;
export function onchainView<
  TName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
>(name: TName, columns: TColumns): ManualViewBuilder<TName, TColumns>;
export function onchainView(
  name: string,
  columns?: Record<string, PgColumnBuilderBase>,
): ViewBuilder | ManualViewBuilder {
  const schema = globalThis?.PONDER_NAMESPACE_BUILD?.schema;

  const view = pgViewWithSchema(name, columns, schema);

  // @ts-expect-error
  view[onchain] = true;

  return view;
}

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

  e[onchain] = true;

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
      // @ts-expect-error
      colBuilder.setName(toSnakeCase(name));
      // @ts-expect-error
      const column = colBuilder.build(rawTable);
      // @ts-expect-error
      rawTable[Symbol.for("drizzle:PgInlineForeignKeys")].push(
        // @ts-expect-error
        ...colBuilder.buildForeignKeys(column, rawTable),
      );
      return [name, column];
    }),
  ) as unknown as BuildColumns<name, columns, "pg">;

  const builtColumnsForExtraConfig = Object.fromEntries(
    Object.entries(parsedColumns).map(([name, colBuilderBase]) => {
      const colBuilder = colBuilderBase as PgColumnBuilder;
      //@ts-expect-error
      colBuilder.setName(toSnakeCase(name));
      //@ts-expect-error
      const column = colBuilder.buildExtraConfigColumn(rawTable);
      return [name, column];
    }),
  ) as unknown as BuildExtraConfigColumns<columns>;

  const table = Object.assign(rawTable, builtColumns);

  //@ts-expect-error
  table[Table.Symbol.Columns] = builtColumns;
  //@ts-expect-error
  table[Table.Symbol.ExtraConfigColumns] = builtColumnsForExtraConfig;

  if (extraConfig) {
    //@ts-expect-error
    table[PgTable.Symbol.ExtraConfigBuilder] = extraConfig as any;
  }

  return Object.assign(table, {
    enableRLS: () => {
      // @ts-expect-error
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

function pgViewWithSchema(
  name: string,
  selection: Record<string, PgColumnBuilderBase> | undefined,
  schema: string | undefined,
): ViewBuilder | ManualViewBuilder {
  if (selection) {
    return new ManualViewBuilder(name, selection, schema);
  }
  return new ViewBuilder(name, schema);
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
