import { expect, test } from "vitest";

import { regex, replaceStateless, shim } from "./plugin.js";

test("regex matches basic", () => {
  const code = `import { ponder } from "@/generated";\n`;

  expect(regex.test(code)).toBe(true);
  const s = replaceStateless(code);
  expect(s.toString().includes(shim)).toBe(true);
});

test("regex matches multiline", () => {
  const code =
    'import { ponder } from "@/generated";\n' +
    'ponder.on("PrimitiveManager:Swap", async ({ event, context }) => {\n';

  expect(regex.test(code)).toBe(true);
  const s = replaceStateless(code);
  expect(s.toString().includes(shim)).toBe(true);
});

test("regex matches import including types before", () => {
  const code = 'import { type Context, ponder } from "@/generated";\n';

  expect(regex.test(code)).toBe(true);
  const s = replaceStateless(code);
  expect(s.toString().includes(shim)).toBe(true);
});

test("regex matches import includinga types after", () => {
  const code = 'import { ponder, type Context } from "@/generated";\n';

  expect(regex.test(code)).toBe(true);
  expect(code.replace(regex, shim).includes(shim)).toBe(true);
});

test("regex matches import including newlines", () => {
  const code =
    "import {\n" + "ponder,\n" + "type Context,\n" + '} from "@/generated";\n';

  expect(regex.test(code)).toBe(true);
  const s = replaceStateless(code);
  expect(s.toString().includes(shim)).toBe(true);
});

test("regex matches no trailing semicolon", () => {
  const code = `import { ponder } from "@/generated"`;

  expect(regex.test(code)).toBe(true);
  const s = replaceStateless(code);
  expect(s.toString().includes(shim)).toBe(true);
});

test("regex matches no trailing single quote import", () => {
  const code = `import { ponder } from '@/generated'`;

  expect(regex.test(code)).toBe(true);
  const s = replaceStateless(code);
  expect(s.toString().includes(shim)).toBe(true);
});

test("regex matches no trailing newline", () => {
  const code = `import { ponder } from "@/generated";ponder.on("PrimitiveManager:Swap", async ({ event, context }) => {`;

  expect(regex.test(code)).toBe(true);
  const s = replaceStateless(code);
  expect(s.toString().includes(shim)).toBe(true);
});

test("regex matches preceding import", () => {
  const code =
    `import {decodeEventLog} from "viem";\n` +
    `import {ponder} from "@/generated";\n`;

  expect(regex.test(code)).toBe(true);
  const s = replaceStateless(code);
  expect(s.toString().includes(shim)).toBe(true);
});
