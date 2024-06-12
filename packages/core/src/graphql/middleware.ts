import type { Schema } from "@/schema/common.js";
import { createMiddleware } from "hono/factory";

export const createGraphQLMiddleware = (_: { schema: Schema }) => {
  return createMiddleware(async (c) => {
    return c.text("graphql");
  });
};
