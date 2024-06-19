import {
  BigIntSerializationError,
  CheckConstraintError,
  NotNullConstraintError,
  StoreError,
} from "@/common/errors.js";
import type {
  Column,
  EnumColumn,
  JSONColumn,
  MaterialColumn,
  ReferenceColumn,
  Scalar,
  ScalarColumn,
  Schema,
  Table,
} from "@/schema/common.js";
import {
  getEnums,
  isEnumColumn,
  isJSONColumn,
  isListColumn,
  isManyColumn,
  isMaterialColumn,
  isOptionalColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import type {
  DatabaseRecord,
  DatabaseValue,
  UserRecord,
  UserValue,
} from "@/types/schema.js";
import { decodeToBigInt, encodeAsText } from "@/utils/encoding.js";
import { never } from "@/utils/never.js";
import { type Hex, bytesToHex, hexToBytes, isHex } from "viem";

const scalarToTsType = {
  int: "number",
  float: "number",
  bigint: "bigint",
  boolean: "boolean",
  string: "string",
  hex: "`0x${string}`",
} as const satisfies { [key in Scalar]: string };

/**
 * Convert a user-land record into a database-ready object.
 */
export function encodeRecord({
  record,
  table,
  schema,
  encoding,
  skipValidation,
}: {
  record: Partial<UserRecord>;
  table: Table;
  schema: Schema;
  encoding: "sqlite" | "postgres";
  skipValidation: boolean;
}): DatabaseRecord {
  const instance: DatabaseRecord = {};

  if (skipValidation === false) validateRecord({ record, table, schema });

  // user data is considered to be valid at this point
  for (const [columnName, value] of Object.entries(record)) {
    const column = table[columnName] as MaterialColumn;

    instance[columnName] = encodeValue({
      value,
      column,
      encoding,
    });
  }

  return instance;
}

/**
 * Convert a user-land value into a database-ready value.
 */
export function encodeValue(
  {
    value,
    column,
    encoding,
  }: {
    value: UserValue;
    column: MaterialColumn;
    encoding: "sqlite" | "postgres";
  },
  // @ts-ignore
): DatabaseValue {
  switch (column[" type"]) {
    case "enum": {
      if (isOptionalColumn(column) && (value === undefined || value === null)) {
        return null;
      }

      if (isListColumn(column)) {
        return JSON.stringify(value);
      }

      return value as string;
    }

    case "json": {
      if (encoding === "postgres") return value as Object;
      return JSON.stringify(value);
    }

    case "reference":
    case "scalar": {
      if (isOptionalColumn(column) && (value === undefined || value === null)) {
        return null;
      }

      if (isListColumn(column)) {
        if (column[" scalar"] === "bigint") {
          return JSON.stringify((value as bigint[]).map(String));
        } else if (column[" scalar"] === "hex") {
          return JSON.stringify(
            (value as string[]).map((v) => (v as string).toLowerCase()),
          );
        } else {
          return JSON.stringify(value);
        }
      }

      switch (column[" scalar"]) {
        case "string":
        case "int":
        case "float":
          return value as DatabaseValue;
        case "hex":
          return Buffer.from(hexToBytes(value as Hex));
        case "bigint":
          return encoding === "sqlite"
            ? encodeAsText(value as bigint)
            : (value as bigint);
        case "boolean":
          return value ? 1 : 0;

        default:
          never(column[" scalar"]);
      }

      break;
    }

    default:
      never(column);
  }
}

export function validateRecord({
  record,
  table,
  schema,
}: {
  record: Partial<UserRecord>;
  table: Table;
  schema: Schema;
}): void {
  for (const [columnName, value] of Object.entries(record)) {
    const column = table[columnName];
    if (!column) {
      throw new StoreError(
        `Invalid record: Column does not exist. Got ${columnName}, expected one of [${Object.keys(
          table,
        )
          .filter(
            (column) =>
              isScalarColumn(table[column]!) ||
              isReferenceColumn(table[column]!) ||
              isEnumColumn(table[column]!) ||
              isJSONColumn(table[column]!),
          )
          .join(", ")}]`,
      );
    }

    validateValue({ value, column, schema });
  }
}

function validateValue({
  value,
  column,
  schema,
}: {
  value: UserValue;
  column: Column;
  schema: Schema;
}): void {
  switch (column[" type"]) {
    case "enum": {
      if (isOptionalColumn(column) && (value === undefined || value === null)) {
        break;
      }

      if (isListColumn(column)) {
        if (!Array.isArray(value)) {
          throw new StoreError(
            `Unable to encode ${value} as a list. Got type '${typeof value}' but expected type 'string[]'.`,
          );
        }
      } else if (typeof value !== "string") {
        throw new StoreError(
          `Unable to encode ${value} as an enum. Got type '${typeof value}' but expected type 'string'.`,
        );
      } else {
        if (getEnums(schema)[column[" enum"]]!.includes(value) === false) {
          throw new CheckConstraintError(
            `Unable to encode ${value} as a '${
              column[" enum"]
            }' enum. Got '${value}' but expected one of [${getEnums(schema)[
              column[" enum"]
            ]!.join(", ")}].`,
          );
        }
      }

      break;
    }

    case "json": {
      try {
        JSON.stringify(value);
      } catch (_error) {
        const error = new BigIntSerializationError(
          (_error as TypeError).message,
        );
        error.meta.push(
          "Hint:\n  The JSON column type does not support BigInt values. Use the replaceBigInts() helper function before inserting into the database. Docs: https://ponder.sh/docs/utilities/replace-bigints",
        );
        throw error;
      }

      break;
    }

    case "reference":
    case "scalar": {
      if (value === undefined || value === null) {
        if (isOptionalColumn(column)) break;
        const error = new NotNullConstraintError(
          `Unable to encode ${value} as a ${
            column[" scalar"]
          }. Got '${typeof value}' but expected type '${scalarToTsType[column[" scalar"]]}'.`,
        );
        error.meta.push(
          "Hint:\n  Use the .optional() modifier to allow for null or undefined values.",
        );
        throw error;
      }

      if (isListColumn(column)) {
        // Note: We are not checking the types of the list elements.
        if (!Array.isArray(value)) {
          throw new StoreError(
            `Unable to encode ${value} as a list. Got type '${typeof value}' but expected type '${
              scalarToTsType[column[" scalar"]]
            }[]'.`,
          );
        }

        break;
      }

      switch (column[" scalar"]) {
        case "string": {
          if (typeof value !== "string") {
            throw new StoreError(
              `Unable to encode ${value} as a string. Got type '${typeof value}' but expected type 'string'.`,
            );
          }
          break;
        }
        case "hex": {
          if (typeof value !== "string" || !isHex(value)) {
            throw new StoreError(
              `Unable to encode ${value} as a hex. Got type '${typeof value}' but expected type '\`0x\${string}\`'.`,
            );
          }
          break;
        }

        case "int":
        case "float": {
          if (typeof value !== "number") {
            throw new StoreError(
              `Unable to encode ${value} as an ${
                column[" scalar"]
              }. Got type '${typeof value}' but expected type 'number'.`,
            );
          }
          break;
        }

        case "bigint": {
          if (typeof value !== "bigint") {
            throw new StoreError(
              `Unable to encode ${value} as a bigint. Got type '${typeof value}' but expected type 'bigint'.`,
            );
          }
          break;
        }

        case "boolean": {
          if (typeof value !== "boolean") {
            throw new StoreError(
              `Unable to encode ${value} as a boolean. Got type '${typeof value}' but expected type 'boolean'.`,
            );
          }
          break;
        }

        default:
          never(column[" scalar"]);
      }

      break;
    }

    case "one":
    case "many": {
      throw new StoreError(
        `Unable to encode ${value} into a "${isManyColumn(column) ? "many" : "one"}" column. "${
          isManyColumn(column) ? "many" : "one"
        }" columns are virtual and therefore should not be given a value.`,
      );
    }

    default:
      never(column);
  }
}

export function decodeRecord({
  record,
  table,
  encoding,
}: {
  record: DatabaseRecord;
  table: Table;
  encoding: "sqlite" | "postgres";
}): UserRecord {
  const instance = {} as UserRecord;

  for (const [columnName, column] of Object.entries(table)) {
    if (isMaterialColumn(column)) {
      instance[columnName] = decodeValue({
        value: record[columnName]!,
        column,
        encoding,
      });
    }
  }

  return instance;
}

function decodeValue({
  value,
  column,
  encoding,
}: {
  value: DatabaseValue;
  column: ScalarColumn | ReferenceColumn | EnumColumn | JSONColumn;
  encoding: "sqlite" | "postgres";
}): UserValue {
  if (value === null) return null;
  else if (isEnumColumn(column)) {
    if (isListColumn(column)) {
      return JSON.parse(value as string);
    }
    return value as UserValue;
  } else if (isJSONColumn(column)) {
    return encoding === "postgres" ? value : JSON.parse(value as string);
  } else if (isListColumn(column)) {
    return column[" scalar"] === "bigint"
      ? JSON.parse(value as string).map(BigInt)
      : JSON.parse(value as string);
  } else if (column[" scalar"] === "boolean") {
    return value === 1;
  } else if (column[" scalar"] === "hex") {
    return bytesToHex(value as Buffer);
  } else if (column[" scalar"] === "bigint" && encoding === "sqlite") {
    return decodeToBigInt(value as string);
  } else {
    return value as UserValue;
  }
}
