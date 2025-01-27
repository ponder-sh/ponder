import { expect, test } from "vitest";
import { validateQuery } from "./validate.js";

test("validateQuery()", () => {
  expect(() => validateQuery("SELECT * FROM users;")).not.toThrow();
  expect(() => validateQuery("SELECT col FROM users LIMIT 1;")).not.toThrow();
  expect(() =>
    validateQuery("SELECT col FROM users JOIN users ON users.id = users.id;"),
  ).not.toThrow();
  expect(() =>
    validateQuery(
      "SELECT col FROM users JOIN users ON users.id = users.id GROUP BY col ORDER BY col;",
    ),
  ).not.toThrow();
  expect(() =>
    validateQuery("WITH cte AS (SELECT * FROM users) SELECT * FROM cte;"),
  ).not.toThrow();
  expect(() =>
    validateQuery("SELECT * FROM users UNION ALL SELECT * FROM admins;"),
  ).not.toThrow();
  expect(() =>
    validateQuery("SELECT * FROM users WHERE col <> $1;"),
  ).not.toThrow();
});

test("validateQuery() cache", () => {
  expect(() => validateQuery("SELECT * FROM users;")).not.toThrow();
  expect(() => validateQuery("SELECT * FROM users;")).not.toThrow();

  expect(() => validateQuery(`SET statement_timeout = '1s';`)).toThrow();
  expect(() => validateQuery(`SET statement_timeout = '1s';`)).toThrow();
});

test("validateQuery() selete into", () => {
  expect(() => validateQuery("SELECT * INTO users;")).toThrow();
});

test("validateQuery() recursive cte", () => {
  expect(() =>
    validateQuery(
      "WITH RECURSIVE infinite_cte AS (SELECT 1 AS num UNION ALL SELECT num + 1 FROM infinite_cte) SELECT * FROM infinite_cte;",
    ),
  ).toThrow();
});

test("validateQuery() function call", () => {
  expect(() => validateQuery("SELECT count(*) from users;")).not.toThrow();
  expect(() => validateQuery("SELECT blow_up();")).toThrow();
});
