import type { Hex } from "viem";
import { assertType, test } from "vitest";
import type {
  EnumColumn,
  ManyColumn,
  OneColumn,
  ReferenceColumn,
  ScalarColumn,
} from "./common.js";
import type {
  InferColumnType,
  InferScalarType,
  InferTableType,
} from "./infer.js";

test("infer scalar string", () => {
  type inferred = InferScalarType<"string">;
  //   ^?

  assertType<inferred>({} as unknown as string);
});

test("infer scalar boolean", () => {
  type inferred = InferScalarType<"boolean">;
  //   ^?

  assertType<inferred>({} as unknown as boolean);
});

test("infer scalar int", () => {
  type inferred = InferScalarType<"int">;
  //   ^?

  assertType<inferred>({} as unknown as number);
});

test("infer scalar float", () => {
  type inferred = InferScalarType<"float">;
  //   ^?

  assertType<inferred>({} as unknown as number);
});

test("infer scalar bigint", () => {
  type inferred = InferScalarType<"bigint">;
  //   ^?

  assertType<inferred>({} as unknown as bigint);
});

test("infer scalar hex", () => {
  type inferred = InferScalarType<"hex">;
  //   ^?

  assertType<inferred>({} as unknown as Hex);
});

test("infer column not list", () => {
  type inferred = InferColumnType<
    //   ^?
    ScalarColumn<"string", false, false>,
    unknown
  >;

  assertType<inferred>({} as unknown as string);
});

test("infer column list", () => {
  type inferred = InferColumnType<ScalarColumn<"string", false, true>, unknown>;
  //   ^?

  assertType<inferred>({} as unknown as string[]);
});

test("infer enum", () => {
  type inferred = InferColumnType<EnumColumn<"enum">, { enum: ["one", "two"] }>;
  //   ^?

  assertType<inferred>({} as unknown as "one" | "two");
});

test("infer table", () => {
  type inferred = InferTableType<
    // ^?
    {
      id: ScalarColumn<"string", false, false>;
      col: ScalarColumn<"string", true, false>;
      ref: ReferenceColumn<"string", false, "table.id">;
      one: OneColumn<"ref">;
      many: ManyColumn<"table", "col">;
      enum: EnumColumn<"enum", false, false>;
    },
    { enum: ["one", "two"] }
  >;

  assertType<inferred>(
    {} as unknown as {
      id: string;
      ref: string;
      col?: string | undefined;
      enum: "one" | "two";
    },
  );
});
