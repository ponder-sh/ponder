import { Hono } from "hono";
import { expect, test } from "vitest";
import type { Handler } from "./handler.js";
import { type PonderRoutes, applyHonoRoutes } from "./index.js";

type MockPonderHono = {
  routes: PonderRoutes;
  get: (
    maybePathOrHandler: string | Handler,
    ...handlers: Handler[]
  ) => MockPonderHono;
  post: (
    maybePathOrHandler: string | Handler,
    ...handlers: Handler[]
  ) => MockPonderHono;
  use: (
    maybePathOrHandler: string | Handler,
    ...handlers: Handler[]
  ) => MockPonderHono;
};

const getMockPonderHono = (): MockPonderHono => ({
  routes: [],
  get(..._handlers) {
    this.routes.push({ method: "GET", pathOrHandlers: _handlers });
    return this;
  },
  post(..._handlers) {
    this.routes.push({ method: "POST", pathOrHandlers: _handlers });
    return this;
  },
  use(..._handlers) {
    this.routes.push({ method: "USE", pathOrHandlers: _handlers });
    return this;
  },
});

test("get() w/o path", async () => {
  const ponderHono = getMockPonderHono().get((c) => {
    return c.text("hi");
  });

  const hono = applyHonoRoutes(new Hono(), ponderHono.routes);

  const response = await hono.request("");
  expect(await response.text()).toBe("hi");
});

test("get() w/ path", async () => {
  const ponderHono = getMockPonderHono().get("/hi", (c) => {
    return c.text("hi");
  });

  const hono = applyHonoRoutes(new Hono(), ponderHono.routes);

  const response = await hono.request("/hi");
  expect(await response.text()).toBe("hi");
});

test("get() w/ middlware", async () => {
  const ponderHono = getMockPonderHono().get(
    "/hi",
    // @ts-ignore
    (c, next) => {
      next();
    },
    (c) => {
      return c.text("hi");
    },
  );

  const hono = applyHonoRoutes(new Hono(), ponderHono.routes);

  const response = await hono.request("/hi");
  expect(await response.text()).toBe("hi");
});

test("use() w/o path", async () => {
  // @ts-ignore
  const ponderHono = getMockPonderHono().use((c, next) => {
    next();
    return c.text("hi");
  });

  const hono = applyHonoRoutes(new Hono(), ponderHono.routes);

  const response = await hono.request("");
  expect(await response.text()).toBe("hi");
});

test("use() w/ path", async () => {
  // @ts-ignore
  const ponderHono = getMockPonderHono().use("/hi", (c, next) => {
    next();
    return c.text("hi");
  });

  const hono = applyHonoRoutes(new Hono(), ponderHono.routes);

  const response = await hono.request("/hi");
  expect(await response.text()).toBe("hi");
});
