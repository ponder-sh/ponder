import { relations } from "drizzle-orm";
import { getTableConfig, pgEnum, pgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pg-proxy";
import { expect, test } from "vitest";
import { setDatabaseSchema } from "./index.js";

test("setDatabaseSchema table", () => {
  const schema = {
    account: pgTable("account", (t) => ({
      address: t.text("address").primaryKey(),
      balance: t.text("balance"),
    })),
  };

  setDatabaseSchema(schema, "hi-kevin");

  const db = drizzle(() => Promise.resolve({ rows: [] }));

  expect(getTableConfig(schema.account).schema).toBe("hi-kevin");
  expect(db.select().from(schema.account).toSQL()).toMatchInlineSnapshot(`
    {
      "params": [],
      "sql": "select "address", "balance" from "hi-kevin"."account"",
    }
  `);
});

test("setDatabaseSchema enum", () => {
  const e = pgEnum("e", ["a", "b", "c"]);
  const schema = {
    e,
    account: pgTable("account", (t) => ({
      address: t.text("address").primaryKey(),
      balance: t.text("balance"),
      e: e(),
    })),
  };

  setDatabaseSchema(schema, "hi-kevin");

  const db = drizzle(() => Promise.resolve({ rows: [] }));

  expect(e.schema).toBe("hi-kevin");
  expect(db.select().from(schema.account).toSQL()).toMatchInlineSnapshot(`
    {
      "params": [],
      "sql": "select "address", "balance", "e" from "hi-kevin"."account"",
    }
  `);
});

test("setDatabaseSchema relations", () => {
  const person = pgTable("person", (t) => ({
    id: t.text("id").primaryKey(),
    name: t.text("name"),
    friendId: t.text("friend_id"),
  }));

  const friendRelation = relations(person, ({ one }) => ({
    friend: one(person, {
      fields: [person.friendId],
      references: [person.id],
    }),
  }));

  const schema = {
    person,
    friendRelation,
  };

  setDatabaseSchema(schema, "hi-kevin");

  const db = drizzle(() => Promise.resolve({ rows: [] }), { schema });

  expect(getTableConfig(friendRelation.table).schema).toBe("hi-kevin");
  expect(
    db.query.person.findMany({ with: { friend: true } }).toSQL(),
  ).toMatchInlineSnapshot(`
    {
      "params": [
        1,
      ],
      "sql": "select "person"."id", "person"."name", "person"."friend_id", "person_friend"."data" as "friend" from "hi-kevin"."person" "person" left join lateral (select json_build_array("person_friend"."id", "person_friend"."name", "person_friend"."friend_id") as "data" from (select * from "hi-kevin"."person" "person_friend" where "person_friend"."id" = "person"."friend_id" limit $1) "person_friend") "person_friend" on true",
      "typings": [
        "none",
      ],
    }
  `);
});
