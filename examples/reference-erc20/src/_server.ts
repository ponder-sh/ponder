import { hono } from "@/generated";

hono.get("/router", (c) => {
  return c.text("kevin");
});

export { hono };
