import { Hono } from "hono";
import { expect, test } from "vitest";
import type { Handler } from "./handler.js";
import { applyPathOrHandlers } from "./index.js";

type MockPonderHono = {
  handlers: Parameters<typeof applyPathOrHandlers>["1"];
  get: (
    maybePathOrHandler: string | Handler,
    ...handlers: Handler[]
  ) => MockPonderHono;
};

const getMockPonderHono = (): MockPonderHono => ({
  handlers: [],
  get(..._handlers) {
    this.handlers.push(_handlers);
    return this;
  },
});

test("get request w/o path", async () => {
  const ponderHono = getMockPonderHono().get((c) => {
    return c.text("hi");
  });

  const hono = applyPathOrHandlers(new Hono(), ponderHono.handlers);

  const response = await hono.request("");
  expect(await response.text()).toBe("hi");
});

test("get request w/ path", async () => {
  const ponderHono = getMockPonderHono().get("/hi", (c) => {
    return c.text("hi");
  });

  const hono = applyPathOrHandlers(new Hono(), ponderHono.handlers);

  const response = await hono.request("/hi");
  expect(await response.text()).toBe("hi");
});

test.todo("get request with multiple handlers");
