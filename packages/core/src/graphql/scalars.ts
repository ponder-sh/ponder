import { GraphQLScalarType, print } from "graphql";

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?)?$/i;
const UNIX_MS_REGEX = /^-?\d+$/;

/**
 * Returns the `Date` for the given UTC date and time fields, or `undefined`
 * if any field is out of range (e.g. February 30th).
 */
const dateFromUTCFields = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date | undefined => {
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const date = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
  );
  // Note: `Date.UTC` rolls over out of range values, so check the fields.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date;
};

/** Parse a unix timestamp in milliseconds, e.g. "1704067200000". */
const parseUnixMs = (value: string): Date | undefined => {
  if (UNIX_MS_REGEX.test(value) === false) return undefined;
  const date = new Date(Number(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * Parse an ISO 8601 date-time string, e.g. "2024-01-01T00:00:00.000Z".
 * A date-time without an offset is interpreted as UTC.
 */
const dateTimeError = (display: string) =>
  new TypeError(
    `Invalid DateTime value ${display}. Expected an ISO 8601 date-time string.`,
  );
const dateError = (display: string) =>
  new TypeError(`Invalid Date value ${display}. Expected a YYYY-MM-DD string.`);

const parseDateTime = (value: unknown): Date => {
  const invalid = () => dateTimeError(JSON.stringify(value) ?? String(value));

  if (typeof value !== "string") throw invalid();

  // Note: Unix timestamps in milliseconds are accepted for backwards compatibility.
  const unixMs = parseUnixMs(value);
  if (unixMs !== undefined) return unixMs;

  const match = DATE_TIME_REGEX.exec(value);
  if (match === null) throw invalid();
  const [, year, month, day, hour, minute, second, fraction, offset] = match;

  const date = dateFromUTCFields(
    Number(year),
    Number(month),
    Number(day),
    Number(hour ?? 0),
    Number(minute ?? 0),
    Number(second ?? 0),
    Number((fraction ?? "").slice(0, 3).padEnd(3, "0")),
  );
  if (date === undefined) throw invalid();

  if (offset !== undefined && offset.toUpperCase() !== "Z") {
    const sign = offset.startsWith("-") ? -1 : 1;
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) throw invalid();
    date.setTime(
      date.getTime() - sign * (offsetHours * 60 + offsetMinutes) * 60_000,
    );
  }

  return date;
};

/** Parse a date string, e.g. "2024-01-01". */
const parseDate = (value: unknown): Date => {
  const invalid = () => dateError(JSON.stringify(value) ?? String(value));

  if (typeof value !== "string") throw invalid();

  // Note: Unix timestamps in milliseconds are accepted for backwards compatibility.
  const unixMs = parseUnixMs(value);
  if (unixMs !== undefined) return unixMs;

  const match = DATE_REGEX.exec(value);
  if (match === null) throw invalid();
  const date = dateFromUTCFields(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  );
  if (date === undefined) throw invalid();
  return date;
};

const serializeDate = (value: unknown): Date => {
  if (value instanceof Date && Number.isNaN(value.getTime()) === false) {
    return value;
  }
  throw new TypeError(`Cannot serialize invalid date value: ${value}`);
};

export const GraphQLDateTime = new GraphQLScalarType({
  name: "DateTime",
  description:
    "The `DateTime` scalar type represents a timestamp as an ISO 8601 string in UTC, e.g. `2024-01-01T00:00:00.000Z`.",
  serialize: (value) => serializeDate(value).toISOString(),
  parseValue: parseDateTime,
  parseLiteral: (ast) => {
    if (ast.kind !== "StringValue") throw dateTimeError(print(ast));
    return parseDateTime(ast.value);
  },
});

export const GraphQLDate = new GraphQLScalarType({
  name: "Date",
  description:
    "The `Date` scalar type represents a calendar date as a `YYYY-MM-DD` string, e.g. `2024-01-01`.",
  serialize: (value) => serializeDate(value).toISOString().slice(0, 10),
  parseValue: parseDate,
  parseLiteral: (ast) => {
    if (ast.kind !== "StringValue") throw dateError(print(ast));
    return parseDate(ast.value);
  },
});
