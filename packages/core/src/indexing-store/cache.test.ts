import { zeroAddress } from "viem";
import { expect, test } from "vitest";
import { onchainEnum, onchainTable } from "@/drizzle/onchain.js";
import { getCopyText } from "./cache.js";

const COPY_ESCAPES: Record<string, string> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
};

/**
 * Parses Postgres's COPY text format into rows of decoded fields.
 *
 * @see https://www.postgresql.org/docs/current/sql-copy.html#id-1.9.3.55.9.2
 */
const parseCopyText = (text: string) => {
  const rows: string[][] = [[]];
  let field = "";
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "\\") {
      const rest = text.slice(i + 1);
      const octal = /^[0-7]{1,3}/.exec(rest)?.[0];
      const hex = /^x[0-9a-fA-F]{1,2}/.exec(rest)?.[0];
      if (octal) {
        field += String.fromCharCode(Number.parseInt(octal, 8));
        i += octal.length;
      } else if (hex) {
        field += String.fromCharCode(Number.parseInt(hex.slice(1), 16));
        i += hex.length;
      } else {
        // Note: Any other backslashed character represents itself.
        field += COPY_ESCAPES[rest[0]!] ?? rest[0]!;
        i += 1;
      }
    } else if (char === "\t") {
      rows.at(-1)!.push(field);
      field = "";
    } else if (char === "\n") {
      rows.at(-1)!.push(field);
      rows.push([]);
      field = "";
    } else {
      field += char;
    }
  }
  rows.at(-1)!.push(field);
  return rows;
};

test("getCopyText() encodes bytes", () => {
  const schema = {
    test: onchainTable("test", (p) => ({
      bytes: p.bytes().primaryKey(),
    })),
  };

  expect(
    getCopyText(schema.test, [
      { bytes: new Uint8Array([0, 128, 255, 1]) },
      { bytes: new Uint8Array([]) },
      { bytes: new Uint8Array([0x5c, 0x4e, 0x09, 0x0a, 0x0d]) },
    ]),
  ).toMatchInlineSnapshot(`
    "\\\\x0080ff01
    \\\\x
    \\\\x5c4e090a0d"
  `);

  const multiColumnSchema = {
    test: onchainTable("test", (p) => ({
      bytes: p.bytes().primaryKey(),
      text: p.text().notNull(),
    })),
  };

  expect(
    getCopyText(multiColumnSchema.test, [
      { bytes: new Uint8Array([0x5c, 0x4e, 0x09, 0x0a, 0x0d]), text: "ok" },
    ]),
  ).toMatchInlineSnapshot(`"\\\\x5c4e090a0d	ok"`);
});

test("getCopyText() encodes column types", () => {
  const e = onchainEnum("e", ["a", "b", "c"]);
  const schema = {
    test: onchainTable("test", (p) => ({
      hex: p.hex().primaryKey(),
      bigint: p.bigint().notNull(),
      e: e().notNull(),
      array: p.integer().array().notNull(),
      bytes: p.bytes().notNull(),
      json: p.json().notNull(),
      null: p.text(),
    })),
  };

  const text = getCopyText(schema.test, [
    {
      hex: zeroAddress,
      bigint: 10n,
      e: "a",
      array: [1, 2, 4],
      bytes: new Uint8Array([0, 128, 255, 1]),
      json: { a: 1, b: 2 },
      null: null,
    },
    {
      hex: "0x0000000000000000000000000000000000000001",
      bigint: 11n,
      e: "b",
      array: [],
      bytes: new Uint8Array([]),
      json: {},
      null: null,
    },
    {
      hex: "0x0000000000000000000000000000000000000002",
      bigint: 12n,
      e: "c",
      array: [0],
      bytes: new Uint8Array([0x5c, 0x4e, 0x09, 0x0a, 0x0d]),
      json: { c: 3 },
      null: null,
    },
  ]);

  // Note: Fields are shown before COPY decoding, e.g. bytes keep their
  // escaped "\\x" prefix and null is "\N".
  expect(text.split("\n").map((row) => row.split("\t"))).toMatchInlineSnapshot(`
    [
      [
        "0x0000000000000000000000000000000000000000",
        "10",
        "a",
        "{1,2,4}",
        "\\\\x0080ff01",
        "{"a":1,"b":2}",
        "\\N",
      ],
      [
        "0x0000000000000000000000000000000000000001",
        "11",
        "b",
        "{}",
        "\\\\x",
        "{}",
        "\\N",
      ],
      [
        "0x0000000000000000000000000000000000000002",
        "12",
        "c",
        "{0}",
        "\\\\x5c4e090a0d",
        "{"c":3}",
        "\\N",
      ],
    ]
  `);
});

test("getCopyText() escapes text", () => {
  const schema = {
    test: onchainTable("test", (p) => ({
      text: p.text().primaryKey(),
      last: p.text().notNull(),
    })),
  };

  const values = [
    "\\\\",
    "\\b",
    "\\f",
    "\\n",
    "\\r",
    "\\t",
    "\\v",
    "\\00",
    "\\x00",
    "\\",
    "\b",
    "\f",
    "\n",
    "\r",
    "\t",
    "\v",
    "\\N",
    "a\tb\nc",
  ];

  const text = getCopyText(
    schema.test,
    values.map((value) => ({ text: value, last: value })),
  );

  expect(JSON.stringify(text)).toMatchInlineSnapshot(
    `""\\\\\\\\\\\\\\\\\\t\\\\\\\\\\\\\\\\\\n\\\\\\\\b\\t\\\\\\\\b\\n\\\\\\\\f\\t\\\\\\\\f\\n\\\\\\\\n\\t\\\\\\\\n\\n\\\\\\\\r\\t\\\\\\\\r\\n\\\\\\\\t\\t\\\\\\\\t\\n\\\\\\\\v\\t\\\\\\\\v\\n\\\\\\\\00\\t\\\\\\\\00\\n\\\\\\\\x00\\t\\\\\\\\x00\\n\\\\\\\\\\t\\\\\\\\\\n\\\\\\b\\t\\\\\\b\\n\\\\\\f\\t\\\\\\f\\n\\\\\\n\\t\\\\\\n\\n\\\\\\r\\t\\\\\\r\\n\\\\\\t\\t\\\\\\t\\n\\\\\\u000b\\t\\\\\\u000b\\n\\\\\\\\N\\t\\\\\\\\N\\na\\\\\\tb\\\\\\nc\\ta\\\\\\tb\\\\\\nc""`,
  );

  // Postgres must decode every row back to the original values, in both the
  // middle and last column.
  expect(parseCopyText(text)).toStrictEqual(
    values.map((value) => [value, value]),
  );
});
