import { expect, test } from "vitest";
import { validateQuery } from "./validate.js";

test("validateQuery()", async () => {
  await validateQuery("SELECT * FROM users;");
  await validateQuery("SELECT col FROM users LIMIT 1;");
  await validateQuery(
    "SELECT col FROM users JOIN users ON users.id = users.id;",
  );
  await validateQuery(
    "SELECT col FROM users JOIN users ON users.id = users.id GROUP BY col ORDER BY col;",
  );
  await validateQuery("WITH cte AS (SELECT * FROM users) SELECT * FROM cte;");
  await validateQuery("SELECT * FROM users UNION ALL SELECT * FROM admins;");
  await validateQuery("SELECT * FROM users WHERE col <> $1;");
});

test("validateQuery() cache", async () => {
  await validateQuery("SELECT * FROM users;");
  await validateQuery("SELECT * FROM users;");

  expect(() =>
    validateQuery(`SET statement_timeout = '1s';`),
  ).rejects.toThrow();
  expect(() =>
    validateQuery(`SET statement_timeout = '1s';`),
  ).rejects.toThrow();
});

test("validateQuery() select into", () => {
  expect(() => validateQuery("SELECT * INTO users;")).rejects.toThrow();
});

test("validateQuery() recursive cte", () => {
  expect(() =>
    validateQuery(
      "WITH RECURSIVE infinite_cte AS (SELECT 1 AS num UNION ALL SELECT num + 1 FROM infinite_cte) SELECT * FROM infinite_cte;",
    ),
  ).rejects.toThrow();
});

test("validateQuery() function call", () => {
  expect(() => validateQuery("SELECT count(*) from users;")).not.toThrow();
  expect(() => validateQuery("SELECT blow_up();")).rejects.toThrow();
});
