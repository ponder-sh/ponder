import { sql } from "drizzle-orm";
import { test } from "vitest";
import { validateQuery } from "./validate.js";

test("validateQuery()", async () => {
  await validateQuery(sql`SELECT * FROM users;`);
});
