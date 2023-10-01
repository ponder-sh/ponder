import { test } from "vitest";

import {
  createSchema,
  createTable,
  list,
  number,
  oneToMany,
  optional,
  string,
} from "./ts-schema";

test("scalars", () => {
  createSchema([createTable("Account", { id: string, age: number })]);
});

test("optional", () => {
  createSchema([createTable("Account", { id: string, age: optional(number) })]);
});

test("lists", () => {
  createSchema([createTable("Account", { id: string, age: list(number) })]);

  createSchema([
    createTable("Account", { id: string, age: optional(list(number)) }),
  ]);
});

// Note: skipping for now because will be easier with stronger types
test.todo("enums");

test("one to one relationship", () => {
  const person = createTable("Person", { id: string, age: number });

  createSchema([person, createTable("Dog", { id: string, owner: person })]);
});

test("one to many relationship", () => {
  const dog = createTable("Dog", { id: string });

  createSchema([
    dog,
    createTable("Person", { id: string, dogs: oneToMany(dog, "owner") }),
  ]);
});
