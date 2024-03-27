import { expect, test } from "vitest";

import {
  ponderRegex,
  ponderShim,
  replaceStateless,
  serverRegex,
  serverShim,
} from "./plugin.js";

test("regex matches basic", () => {
  const code = `import { ponder } from "@/generated";\n`;

  expect(ponderRegex.test(code)).toBe(true);
  const s = replaceStateless(code, ponderRegex, ponderShim);
  expect(s.toString().includes(ponderShim)).toBe(true);
});

test("regex matches multiline", () => {
  const code =
    'import { ponder } from "@/generated";\n' +
    'ponder.on("PrimitiveManager:Swap", async ({ event, context }) => {\n';

  expect(ponderRegex.test(code)).toBe(true);
  const s = replaceStateless(code, ponderRegex, ponderShim);
  expect(s.toString().includes(ponderShim)).toBe(true);
});

test("regex matches import including types before", () => {
  const code = 'import { type Context, ponder } from "@/generated";\n';

  expect(ponderRegex.test(code)).toBe(true);
  const s = replaceStateless(code, ponderRegex, ponderShim);
  expect(s.toString().includes(ponderShim)).toBe(true);
});

test("regex matches import includinga types after", () => {
  const code = 'import { ponder, type Context } from "@/generated";\n';

  expect(ponderRegex.test(code)).toBe(true);
  expect(code.replace(ponderRegex, ponderShim).includes(ponderShim)).toBe(true);
});

test("regex matches import including newlines", () => {
  const code =
    "import {\n" + "ponder,\n" + "type Context,\n" + '} from "@/generated";\n';

  expect(ponderRegex.test(code)).toBe(true);
  const s = replaceStateless(code, ponderRegex, ponderShim);
  expect(s.toString().includes(ponderShim)).toBe(true);
});

test("regex matches no trailing semicolon", () => {
  const code = `import { ponder } from "@/generated"`;

  expect(ponderRegex.test(code)).toBe(true);
  const s = replaceStateless(code, ponderRegex, ponderShim);
  expect(s.toString().includes(ponderShim)).toBe(true);
});

test("regex matches no trailing single quote import", () => {
  const code = `import { ponder } from '@/generated'`;

  expect(ponderRegex.test(code)).toBe(true);
  const s = replaceStateless(code, ponderRegex, ponderShim);
  expect(s.toString().includes(ponderShim)).toBe(true);
});

test("regex matches no trailing newline", () => {
  const code = `import { ponder } from "@/generated";ponder.on("PrimitiveManager:Swap", async ({ event, context }) => {`;

  expect(ponderRegex.test(code)).toBe(true);
  const s = replaceStateless(code, ponderRegex, ponderShim);
  expect(s.toString().includes(ponderShim)).toBe(true);
});

test("regex matches preceding import", () => {
  const code =
    `import {decodeEventLog} from "viem";\n` +
    `import {ponder} from "@/generated";\n`;

  expect(ponderRegex.test(code)).toBe(true);
  const s = replaceStateless(code, ponderRegex, ponderShim);
  expect(s.toString().includes(ponderShim)).toBe(true);
});

test("server regex matches basic", () => {
  const code = `import { server } from "@/generated";\n`;

  expect(serverRegex.test(code)).toBe(true);
  const s = replaceStateless(code, serverRegex, serverShim);
  expect(s.toString().includes(serverShim)).toBe(true);
});
