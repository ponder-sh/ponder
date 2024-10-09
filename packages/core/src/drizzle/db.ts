import { type BuildColumns, type ColumnBuilderBase, Table } from "drizzle-orm";
import {
  type AnyPgColumn,
  type PrimaryKeyBuilder as DrizzlePrimaryKeyBuilder,
  type ExtraConfigColumn,
  type PgColumnBuilder,
  type PgColumnBuilderBase,
  type PgNumericBuilderInitial,
  PgSchema,
  PgTable,
  type PgTableExtraConfig,
  type PgTableWithColumns,
  type TableConfig,
  primaryKey as drizzlePrimaryKey,
  numeric,
} from "drizzle-orm/pg-core";
import {
  type PgColumnsBuilders as _PgColumnsBuilders,
  getPgColumnBuilders,
} from "drizzle-orm/pg-core/columns/all";
import { PgHexBuilder, type PgHexBuilderInitial } from "./hex.js";
import { onchain } from "./index.js";

type $Type<T extends ColumnBuilderBase, TType> = T & {
  _: {
    $type: TType;
  };
};

// @ts-ignore
export function evmHex(): PgHexBuilderInitial<"">;
export function evmHex<name extends string>(
  columnName: name,
): PgHexBuilderInitial<name>;
export function evmHex(columnName?: string) {
  return new PgHexBuilder(columnName ?? "");
}

// @ts-ignore
export function evmBigint(): $Type<PgNumericBuilderInitial<"">, bigint>;
export function evmBigint<name extends string>(
  columnName: name,
): $Type<PgNumericBuilderInitial<name>, bigint>;
export function evmBigint(columnName?: string) {
  return numeric(columnName ?? "", { precision: 78 });
}

export {
  sql,
  eq,
  gt,
  gte,
  lt,
  lte,
  ne,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  exists,
  notExists,
  between,
  notBetween,
  like,
  notIlike,
  not,
  asc,
  desc,
  and,
  or,
  count,
  countDistinct,
  avg,
  avgDistinct,
  sum,
  sumDistinct,
  max,
  min,
  relations,
} from "drizzle-orm";

export {
  bigserial,
  boolean,
  char,
  cidr,
  date,
  doublePrecision,
  pgEnum,
  inet,
  integer,
  interval,
  json,
  jsonb,
  line,
  macaddr,
  macaddr8,
  numeric,
  point,
  real,
  serial,
  smallint,
  smallserial,
  text,
  time,
  timestamp,
  uuid,
  varchar,
  index,
  uniqueIndex,
  alias,
  foreignKey,
  union,
  unionAll,
  intersect,
  intersectAll,
  except,
  exceptAll,
} from "drizzle-orm/pg-core";

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
} & { [onchain]: true };

export type OffchainTable<T extends TableConfig> = PgTable<T> & {
  [Key in keyof T["columns"]]: T["columns"][Key];
};

type BuildExtraConfigColumns<
  columns extends Record<string, ColumnBuilderBase>,
> = {
  [key in keyof columns]: ExtraConfigColumn & {
    " name": key;
  };
};

type PgColumnsBuilders = _PgColumnsBuilders & {
  evmHex: typeof evmHex;
  evmBigint: typeof evmBigint;
};

// TODO(kyle) add objects at runtime

/**
 * Create an onchain table
 *
 * @returns The offchain table.
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
  const table = pgTableWithSchema(name, columns, extraConfig as any, undefined);

  /**
   * This trick is used to make `table instanceof PgTable` evaluate to false.
   * This is necessary to avoid generating migrations for onchain tables.
   */
  Object.setPrototypeOf(table, Object.prototype);

  // @ts-ignore
  table[onchain] = true;

  // @ts-ignore
  return table;
};

export class OffchainSchema<schema extends string> extends PgSchema<schema> {
  override table = <
    name extends string,
    columns extends Record<string, PgColumnBuilderBase>,
  >(
    name: name,
    columns: columns | ((columnTypes: PgColumnsBuilders) => columns),
    extraConfig?: (
      self: BuildExtraConfigColumns<columns>,
    ) => PgTableExtraConfig,
  ): OffchainTable<{
    name: name;
    schema: schema;
    columns: BuildColumns<name, columns, "pg">;
    dialect: "pg";
  }> => pgTableWithSchema(name, columns, extraConfig, this.schemaName);
}

export const offchainSchema = <T extends string>(name: T) =>
  new OffchainSchema(name);

/**
 * Create an offchain table
 *
 * @returns The offchain table.
 */
export const offchainTable = <
  name extends string,
  columns extends Record<string, PgColumnBuilderBase>,
>(
  name: name,
  columns: columns | ((columnTypes: PgColumnsBuilders) => columns),
  extraConfig?: (self: BuildExtraConfigColumns<columns>) => PgTableExtraConfig,
): OffchainTable<{
  name: name;
  schema: undefined;
  columns: BuildColumns<name, columns, "pg">;
  dialect: "pg";
}> => pgTableWithSchema(name, columns, extraConfig, undefined);

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

  const parsedColumns: columns =
    typeof columns === "function"
      ? columns({ ...getPgColumnBuilders(), evmHex, evmBigint })
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

  return table;
}
