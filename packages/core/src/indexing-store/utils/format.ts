import type {
  EnumColumn,
  NonReferenceColumn,
  ReferenceColumn,
  Scalar,
  Schema,
} from "@/schema/types.js";
import { isBaseColumn, isEnumColumn } from "@/schema/utils.js";
import { decodeToBigInt, encodeAsText } from "@/utils/encoding.js";
import { bytesToHex, hexToBytes, isHex } from "viem";
import type { Row } from "../store.js";

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
  data: Partial<Row>,
  table: Schema["tables"][keyof Schema["tables"]],
  encoding: "sqlite" | "postgres",
) {
  const instance: { [key: string]: string | number | null | bigint | Buffer } =
    {};

  for (const [key, value] of Object.entries(data)) {
    if (table[key] === undefined) {
      throw Error(
        `Column encoding failed: column ${key} is not an exisitng column. Expected one of [${Object.keys(
          table,
        )
          .filter((key) => isBaseColumn(table[key]) || isEnumColumn(table[key]))
          .join(", ")}]`,
      );
    }

    instance[key] = encodeColumn(value, table[key], encoding);
  }

  return instance;
}

/**
 * Convert a user-land column value into a database-ready column value.
 */
export function encodeColumn(
  value: unknown,
  column: Schema["tables"][keyof Schema["tables"]][string],
  encoding: "sqlite" | "postgres",
): string | number | null | bigint | Buffer {
  if (isEnumColumn(column)) {
    if (typeof value !== "string") {
      throw Error(
        `Column encoding failed: Unable to encode ${value} into an enum column. Got type '${typeof value}' but expected type 'string'.`,
      );
    }
    return value;
  } else if (isBaseColumn(column)) {
    if (column.optional && (value === undefined || value === null)) {
      return null;
    }

    if (column.list) {
      // Note: We are not checking the types of the list elements.
      if (!Array.isArray(value)) {
        throw Error(
          `Column encoding failed: Unable to encode ${value} into a list column. Got type '${typeof value}' but expected type '${
            scalarToTsType[column.type]
          }[]'.`,
        );
      }

      if (column.type === "bigint") {
        return JSON.stringify(value.map(String));
      } else {
        return JSON.stringify(value);
      }
    }

    if (column.type === "string") {
      if (typeof value !== "string") {
        throw Error(
          `Column encoding failed: Unable to encode ${value} into a string column. Got type '${typeof value}' but expected type 'string'.`,
        );
      }
      return value;
    } else if (column.type === "hex") {
      if (typeof value !== "string" || !isHex(value)) {
        throw Error(
          `Column encoding failed: Unable to encode ${value} into a hex column. Got type '${typeof value}' but expected type '\`0x\${string}\`'.`,
        );
      }
      return Buffer.from(hexToBytes(value));
    } else if (column.type === "int") {
      if (typeof value !== "number") {
        throw Error(
          `Column encoding failed: Unable to encode ${value} into an int column. Got type '${typeof value}' but expected type 'number'.`,
        );
      }
      return value;
    } else if (column.type === "float") {
      if (typeof value !== "number") {
        throw Error(
          `Column encoding failed: Unable to encode ${value} into a float column. Got type '${typeof value}' but expected type 'number'.`,
        );
      }
      return value;
    } else if (column.type === "bigint") {
      if (typeof value !== "bigint") {
        throw Error(
          `Column encoding failed: Unable to encode ${value} into a bigint column. Got type '${typeof value}' but expected type 'bigint'.`,
        );
      }
      return encoding === "sqlite" ? encodeAsText(value) : value;
    } else if (column.type === "boolean") {
      if (typeof value !== "boolean") {
        throw Error(
          `Column encoding failed: Unable to encode ${value} into a boolean column. Got type '${typeof value}' but expected type 'boolean'.`,
        );
      }
      return value ? 1 : 0;
    }

    // Note: it should be impossible to get to this line
    throw Error(
      `Column encoding failed: Unable to encode ${value} into column of type ${column.type}. Please report this issue (https://github.com/ponder-sh/ponder/issues/new)`,
    );
  }

  // Column is either "many" or "one"
  throw Error(
    `Column encoding failed: Unable to encode ${value} into a "${
      column._type === "m" ? "many" : "one"
    }" column. "${
      column._type === "m" ? "many" : "one"
    }" columns are virtual and therefore should not be given a value.`,
  );
}

export function decodeRow(
  data: Partial<Row>,
  table: Schema["tables"][keyof Schema["tables"]],
  encoding: "sqlite" | "postgres",
): Row {
  const instance: { [key: string]: string | number | null | bigint | Buffer } =
    {};

  for (const [columnName, column] of Object.entries(table)) {
    if (isBaseColumn(column) || isEnumColumn(column)) {
      instance[columnName] = decodeColumn(data[columnName], column, encoding);
    }
  }

  return instance as Row;
}

function decodeColumn(
  value: unknown,
  column: NonReferenceColumn | ReferenceColumn | EnumColumn,
  encoding: "sqlite" | "postgres",
) {
  if (column.list) {
    return column.type === "bigint"
      ? JSON.parse(value as string).map(BigInt)
      : JSON.parse(value as string);
  } else if (column.type === "boolean") {
    return value === 1 ? true : false;
  } else if (column.type === "hex") {
    return bytesToHex(value as Buffer);
  } else if (column.type === "bigint" && encoding === "sqlite") {
    return decodeToBigInt(value as string);
  } else {
    return value;
  }
}
