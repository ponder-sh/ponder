import type { IndexingStore } from "@/indexing-store/store.js";
import type { GraphQLSchema } from "graphql";
import { expect, test } from "vitest";
import { createServer } from "./service.js";

test.todo("port");

test("not healthy", async (context) => {
  const server = createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, maxHealthcheckDuration: 5_000 },
    },
    indexingStore: {} as IndexingStore,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(503);
});

test("healthy", async (context) => {
  const server = createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: {
      ...context.common,
      options: { ...context.common.options, maxHealthcheckDuration: 0 },
    },
    indexingStore: {} as IndexingStore,
  });

  const response = await server.hono.request("/health");

  expect(response.status).toBe(200);
});

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

test.only("kill", async (context) => {
  const server = createServer({
    graphqlSchema: {} as GraphQLSchema,
    common: context.common,
    indexingStore: {} as IndexingStore,
  });

  await server.kill();

  expect(() => server.hono.request("/")).toThrowError();
});
