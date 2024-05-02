import { StoreError } from "@/common/errors.js";
import type {
  Column,
  EnumColumn,
  ReferenceColumn,
  Scalar,
  ScalarColumn,
  Table,
} from "@/schema/common.js";
import {
  isEnumColumn,
  isListColumn,
  isManyColumn,
  isOptionalColumn,
  isReferenceColumn,
  isScalarColumn,
} from "@/schema/utils.js";
import type {
  DatabaseColumn,
  DatabaseRow,
  UserColumn,
  UserRow,
} from "@/types/schema.js";
import { decodeToBigInt, encodeAsText } from "@/utils/encoding.js";
import { bytesToHex, hexToBytes, isHex } from "viem";

const scalarToTsType = {
  int: "number",
  float: "number",
  bigint: "bigint",
  boolean: "boolean",
  string: "string",
  hex: "`0x${string}`",
} as const satisfies { [key in Scalar]: string };

/**
 * Convert a user-land row into a database-ready object.
 */
export function encodeRow(
  data: Partial<UserRow>,
  table: Table,
  encoding: "sqlite" | "postgres",
): DatabaseRow {
  const instance: DatabaseRow = {};

  for (const [columnName, value] of Object.entries(data)) {
    const column = table[columnName];
    if (!column) {
      throw new StoreError(
        `Invalid record: Column does not exist. Got ${columnName}, expected one of [${Object.keys(
          table,
        )
          .filter(
            (column) =>
              isScalarColumn(table[column]) ||
              isReferenceColumn(table[column]) ||
              isEnumColumn(table[column]),
          )
          .join(", ")}]`,
      );
    }

    instance[columnName] = encodeValue(value, column, encoding);
  }

  return instance;
}

/**
 * Convert a user-land value into a database-ready value.
 */
export function encodeValue(
  value: UserColumn,
  column: Column,
  encoding: "sqlite" | "postgres",
): DatabaseColumn {
  if (isEnumColumn(column)) {
    if (isOptionalColumn(column) && (value === undefined || value === null)) {
      return null;
    }

    if (isListColumn(column)) {
      if (!Array.isArray(value)) {
        throw new StoreError(
          `Unable to encode ${value} as a list. Got type '${typeof value}' but expected type 'string[]'.`,
        );
      }

      return JSON.stringify(value);
    } else if (typeof value !== "string") {
      throw new StoreError(
        `Unable to encode ${value} as an enum. Got type '${typeof value}' but expected type 'string'.`,
      );
    }
    return value;
  } else if (isScalarColumn(column) || isReferenceColumn(column)) {
    if (isOptionalColumn(column) && (value === undefined || value === null)) {
      return null;
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

      if (column[" scalar"] === "bigint") {
        return JSON.stringify(value.map(String));
      } else {
        return JSON.stringify(value);
      }
    }

    if (column[" scalar"] === "string") {
      if (typeof value !== "string") {
        throw new StoreError(
          `Unable to encode ${value} as a string. Got type '${typeof value}' but expected type 'string'.`,
        );
      }
      return value;
    } else if (column[" scalar"] === "hex") {
      if (typeof value !== "string" || !isHex(value)) {
        throw new StoreError(
          `Unable to encode ${value} as a hex. Got type '${typeof value}' but expected type '\`0x\${string}\`'.`,
        );
      }
      return Buffer.from(hexToBytes(value));
    } else if (column[" scalar"] === "int") {
      if (typeof value !== "number") {
        throw new StoreError(
          `Unable to encode ${value} as an int. Got type '${typeof value}' but expected type 'number'.`,
        );
      }
      return value;
    } else if (column[" scalar"] === "float") {
      if (typeof value !== "number") {
        throw new StoreError(
          `Unable to encode ${value} as a float. Got type '${typeof value}' but expected type 'number'.`,
        );
      }
      return value;
    } else if (column[" scalar"] === "bigint") {
      if (typeof value !== "bigint") {
        throw new StoreError(
          `Unable to encode ${value} as a bigint. Got type '${typeof value}' but expected type 'bigint'.`,
        );
      }
      return encoding === "sqlite" ? encodeAsText(value) : value;
    } else if (column[" scalar"] === "boolean") {
      if (typeof value !== "boolean") {
        throw new StoreError(
          `Unable to encode ${value} as a boolean. Got type '${typeof value}' but expected type 'boolean'.`,
        );
      }
      return value ? 1 : 0;
    }

    // Note: it should be impossible to get to this line
    throw new StoreError(
      `Unable to encode ${value} as type ${column[" scalar"]}. Please report this issue (https://github.com/ponder-sh/ponder/issues/new)`,
    );
  }

  // Column is either "many" or "one"
  throw new StoreError(
    `Unable to encode ${value} into a "${
      isManyColumn(column) ? "many" : "one"
    }" column. "${
      isManyColumn(column) ? "many" : "one"
    }" columns are virtual and therefore should not be given a value.`,
  );
}

export function decodeRow(
  data: DatabaseRow,
  table: Table,
  encoding: "sqlite" | "postgres",
): UserRow {
  const instance = {} as UserRow;

  for (const [columnName, column] of Object.entries(table)) {
    if (
      isScalarColumn(column) ||
      isReferenceColumn(column) ||
      isEnumColumn(column)
    ) {
      instance[columnName] = decodeValue(data[columnName], column, encoding);
    }
  }

  return instance;
}

function decodeValue(
  value: DatabaseColumn,
  column: ScalarColumn | ReferenceColumn | EnumColumn,
  encoding: "sqlite" | "postgres",
): UserColumn {
  if (value === null) return null;
  else if (isEnumColumn(column)) {
    if (isListColumn(column)) {
      return JSON.parse(value as string);
    }
    return value as UserColumn;
  } else if (isListColumn(column)) {
    return column[" scalar"] === "bigint"
      ? JSON.parse(value as string).map(BigInt)
      : JSON.parse(value as string);
  } else if (column[" scalar"] === "boolean") {
    return value === 1 ? true : false;
  } else if (column[" scalar"] === "hex") {
    return bytesToHex(value as Buffer);
  } else if (column[" scalar"] === "bigint" && encoding === "sqlite") {
    return decodeToBigInt(value as string);
  } else {
    return value as UserColumn;
  }
}
