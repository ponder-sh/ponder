import type { Common } from "@/common/common.js";
import type { IndexingStore } from "@/indexing-store/store.js";
import type { GraphQLSchema } from "graphql";
import { expect, test } from "vitest";
import { createServer } from "./service.js";

test("not healthy", async () => {
  const server = createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: { options: { maxHealthcheckDuration: 5_000 } } as Common,
    indexingStore: {} as IndexingStore,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(503);
});

test.todo("healthy", async () => {});

test.todo("metrics", async () => {});

test.todo("metrics error", async () => {});

test.todo("graphql", async () => {
  // const response = await server.hono.request("/graphql", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //   },
  //   body: JSON.stringify({
  //     query: `
  //     query HI {
  //       tables {
  //         items {
  //           id
  //           string
  //           int
  //         }
  //       }
  //     }
  //   `,
  //   }),
  // });
});

test.todo("graphql interactive");

test.todo("kill");
