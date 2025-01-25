import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { validateQuery } from "./validate.js";

test("validateQuery()", () => {
  expect(() => validateQuery(sql`SELECT * FROM users;`)).not.toThrow();
  expect(() =>
    validateQuery(sql`SELECT col FROM users LIMIT 1;`),
  ).not.toThrow();
  expect(() =>
    validateQuery(
      sql`SELECT col FROM users JOIN users ON users.id = users.id;`,
    ),
  ).not.toThrow();
  expect(() =>
    validateQuery(
      sql`SELECT col FROM users JOIN users ON users.id = users.id GROUP BY col ORDER BY col;`,
    ),
  ).not.toThrow();
  expect(() =>
    validateQuery(sql`WITH cte AS (SELECT * FROM users) SELECT * FROM cte;`),
  ).not.toThrow();
  expect(() =>
    validateQuery(sql`SELECT * FROM users UNION ALL SELECT * FROM admins;`),
  ).not.toThrow();
  expect(() =>
    validateQuery(sql`SELECT * FROM users WHERE col <> $1;`),
  ).not.toThrow();
});

test("validateQuery() cache", () => {
  expect(() => validateQuery(sql`SELECT * FROM users;`)).not.toThrow();
  expect(() => validateQuery(sql`SELECT * FROM users;`)).not.toThrow();

  expect(() => validateQuery(sql`SET statement_timeout = '1s';`)).toThrow();
  expect(() => validateQuery(sql`SET statement_timeout = '1s';`)).toThrow();
});

test("validateQuery() selete into", () => {
  expect(() => validateQuery(sql`SELECT * INTO users;`)).toThrow();
});

test("validateQuery() recursive cte", () => {
  expect(() =>
    validateQuery(
      sql`WITH RECURSIVE infinite_cte AS (SELECT 1 AS num UNION ALL SELECT num + 1 FROM infinite_cte) SELECT * FROM infinite_cte;`,
    ),
  ).toThrow();
});

test("validateQuery() function call", () => {
  expect(() => validateQuery(sql`SELECT count(*) from users;`)).not.toThrow();
  expect(() => validateQuery(sql`SELECT blow_up();`)).toThrow();
});
