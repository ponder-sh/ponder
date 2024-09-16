import { createSchema } from "@/schema/schema.js";
import { zeroAddress } from "viem";

export const petPerson = createSchema((p) => ({
  PetKind: p.createEnum(["CAT", "DOG"]),
  Pet: p.createTable(
    {
      id: p.string(),
      name: p.string(),
      age: p.int().optional(),
      bigAge: p.bigint().optional(),
      kind: p.enum("PetKind").optional(),
    },
    {
      multiIndex: p.index(["name", "age"]),
    },
  ),
  Person: p.createTable(
    {
      id: p.string(),
      name: p.string(),
    },
    {
      nameIndex: p.index("name"),
    },
  ),
}));

export const dogApple = createSchema((p) => ({
  Dog: p.createTable({
    id: p.string(),
    name: p.string(),
    age: p.int().optional(),
    bigAge: p.bigint().optional(),
  }),
  Apple: p.createTable({
    id: p.string(),
    name: p.string(),
  }),
}));

export const dogWithDefaults = createSchema((p) => ({
  Dog: p.createTable({
    id: p.string().default("0"),
    name: p.string().default("firstname"),
    age: p.int().default(5).optional(),
    bigAge: p.bigint().default(5n).optional(),
    bowl: p.hex().default(zeroAddress),
    toys: p.json().default({
      bone: "sofa",
      ball: "bed",
    }),
    commands: p.json().default([
      "sit",
      "stay",
      {
        paw: {
          right: true,
          left: false,
        },
      },
    ]),
  }),
}));
