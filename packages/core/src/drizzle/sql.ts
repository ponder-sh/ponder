import { Table, is } from "drizzle-orm";
import {
  PgColumn,
  PgEnumColumn,
  type PgTable,
  type TableConfig,
  getTableConfig,
  integer,
  pgTable,
  serial,
  varchar,
} from "drizzle-orm/pg-core";

export const pgNativeTypes = new Set([
  "uuid",
  "smallint",
  "integer",
  "bigint",
  "boolean",
  "text",
  "varchar",
  "serial",
  "bigserial",
  "decimal",
  "numeric",
  "real",
  "json",
  "jsonb",
  "time",
  "time with time zone",
  "time without time zone",
  "time",
  "timestamp",
  "timestamp with time zone",
  "timestamp without time zone",
  "date",
  "interval",
  "bigint",
  "bigserial",
  "double precision",
  "interval year",
  "interval month",
  "interval day",
  "interval hour",
  "interval minute",
  "interval second",
  "interval year to month",
  "interval day to hour",
  "interval day to minute",
  "interval day to second",
  "interval hour to minute",
  "interval hour to second",
  "interval minute to second",
]);

const isPgNativeType = (it: string) => {
  if (pgNativeTypes.has(it)) return true;
  const toCheck = it.replace(/ /g, "");
  return (
    toCheck.startsWith("varchar(") ||
    toCheck.startsWith("char(") ||
    toCheck.startsWith("numeric(") ||
    toCheck.startsWith("timestamp(") ||
    toCheck.startsWith("doubleprecision[") ||
    toCheck.startsWith("intervalyear(") ||
    toCheck.startsWith("intervalmonth(") ||
    toCheck.startsWith("intervalday(") ||
    toCheck.startsWith("intervalhour(") ||
    toCheck.startsWith("intervalminute(") ||
    toCheck.startsWith("intervalsecond(") ||
    toCheck.startsWith("intervalyeartomonth(") ||
    toCheck.startsWith("intervaldaytohour(") ||
    toCheck.startsWith("intervaldaytominute(") ||
    toCheck.startsWith("intervaldaytosecond(") ||
    toCheck.startsWith("intervalhourtominute(") ||
    toCheck.startsWith("intervalhourtosecond(") ||
    toCheck.startsWith("intervalminutetosecond(") ||
    toCheck.startsWith("vector(") ||
    toCheck.startsWith("geometry(") ||
    /^(\w+)(\[\d*])+$/.test(it)
  );
};

/** @see https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-kit/src/sqlgenerator.ts#L134 */

export const generateTableSQL = ({
  table,
  namespace,
  namePrefix,
  extraColumns,
}: {
  table: PgTable;
  namespace: string;
  namePrefix?: string;
  extraColumns?: PgColumn[];
}) => {
  const config = getTableConfig(table);
  const tableName = config.name;
  const columns = config.columns;
  const primaryKeys = config.primaryKeys;

  let statement = "";
  const name = namespace
    ? `"${namespace}"."${namePrefix ?? ""}${tableName}"`
    : `"${namePrefix ?? ""}${tableName}"`;

  statement += `CREATE TABLE IF NOT EXISTS ${name} (\n`;
  for (let i = 0; i < columns.length; i++) {
    const column = columns[i]!;

    const primaryKeyStatement =
      column.primary && extraColumns === undefined ? " PRIMARY KEY" : "";
    const notNullStatement =
      column.notNull && !column.generatedIdentity ? " NOT NULL" : "";
    const defaultStatement =
      column.default !== undefined ? ` DEFAULT ${column.default}` : "";

    const uniqueConstraint = column.isUnique
      ? ` CONSTRAINT "${column.uniqueName}" UNIQUE${column.uniqueType === "not distinct" ? " NULLS NOT DISTINCT" : ""}`
      : "";

    const typeSchema = is(column, PgEnumColumn)
      ? column.enum.schema || "public"
      : undefined;

    const schemaPrefix =
      typeSchema && typeSchema !== "public" ? `"${typeSchema}".` : "";

    const type = isPgNativeType(column.getSQLType())
      ? column.getSQLType()
      : `${schemaPrefix}"${column.getSQLType()}"`;
    const generated = column.generated;

    const generatedStatement = generated
      ? ` GENERATED ALWAYS AS (${generated?.as}) STORED`
      : "";

    // const unsquashedIdentity = column.generatedIdentity
    //   ? PgSquasher.unsquashIdentity(column.identity)
    //   : undefined;

    // const identityWithSchema = schema
    //   ? `"${schema}"."${unsquashedIdentity?.name}"`
    //   : `"${unsquashedIdentity?.name}"`;

    // const identity = unsquashedIdentity
    //   ? ` GENERATED ${
    //       unsquashedIdentity.type === "always" ? "ALWAYS" : "BY DEFAULT"
    //     } AS IDENTITY (sequence name ${identityWithSchema}${
    //       unsquashedIdentity.increment
    //         ? ` INCREMENT BY ${unsquashedIdentity.increment}`
    //         : ""
    //     }${
    //       unsquashedIdentity.minValue
    //         ? ` MINVALUE ${unsquashedIdentity.minValue}`
    //         : ""
    //     }${
    //       unsquashedIdentity.maxValue
    //         ? ` MAXVALUE ${unsquashedIdentity.maxValue}`
    //         : ""
    //     }${
    //       unsquashedIdentity.startWith
    //         ? ` START WITH ${unsquashedIdentity.startWith}`
    //         : ""
    //     }${unsquashedIdentity.cache ? ` CACHE ${unsquashedIdentity.cache}` : ""}${
    //       unsquashedIdentity.cycle ? ` CYCLE` : ""
    //     })`
    //   : "";

    statement += `\t"${column.name}" ${type}${primaryKeyStatement}${defaultStatement}${generatedStatement}${notNullStatement}${uniqueConstraint}`;
    statement +=
      i === columns.length - 1 && extraColumns === undefined ? "" : ",\n";
  }

  if (extraColumns) {
    for (let i = 0; i < extraColumns.length; i++) {
      const column = extraColumns[i]!;

      const primaryKeyStatement = column.primary ? " PRIMARY KEY" : "";
      const notNullStatement =
        column.notNull && !column.generatedIdentity ? " NOT NULL" : "";

      const type = column.getSQLType();

      statement += `\t"${column.name}" ${type}${primaryKeyStatement}${notNullStatement}`;
      statement += i === extraColumns.length - 1 ? "" : ",\n";
    }
  }

  // TODO(kyle) indexes

  if (
    extraColumns === undefined &&
    typeof primaryKeys !== "undefined" &&
    primaryKeys.length > 0
  ) {
    statement += ",\n";

    statement += `\tCONSTRAINT "${primaryKeys[0]!.getName()}" PRIMARY KEY(\"${primaryKeys[0]!.columns.map((c) => c.name).join(`","`)}\")`;
    // statement += `\n`;
  }

  // if (
  //   typeof uniqueConstraints !== "undefined" &&
  //   uniqueConstraints.length > 0
  // ) {
  //   for (const uniqueConstraint of uniqueConstraints) {
  //     statement += ",\n";
  //     const unsquashedUnique = PgSquasher.unsquashUnique(uniqueConstraint);
  //     statement += `\tCONSTRAINT "${unsquashedUnique.name}" UNIQUE${
  //       unsquashedUnique.nullsNotDistinct ? " NULLS NOT DISTINCT" : ""
  //     }(\"${unsquashedUnique.columns.join(`","`)}\")`;
  //     // statement += `\n`;
  //   }
  // }
  statement += "\n);";
  statement += "\n";

  return statement;
};

export const getPrimaryKeyColumns = (table: PgTable): string[] => {
  const tableConfig = getTableConfig(table);
  if (tableConfig.primaryKeys.length > 0) {
    return tableConfig.primaryKeys[0]!.columns.map((c) => c.name);
  }

  const pkColumn = tableConfig.columns.find((c) => c.primary)!;

  return [pkColumn.name];
};

export const getReorgTable = (table: PgTable<TableConfig>) => {
  const config = getTableConfig(table);

  const t = pgTable(`_ponder_reorg__${config.name}`, {
    operation_id: serial("operation_id").notNull().primaryKey(),
    operation: integer("operation").notNull(),
    checkpoint: varchar("checkpoint", {
      length: 75,
    }).notNull(),
  });

  for (const [field, col] of Object.entries(table)) {
    if (is(col, PgColumn)) {
      // @ts-ignore
      t[Table.Symbol.Columns][field] = col;
    }
  }

  return t;
};
