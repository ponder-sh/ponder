import { hono } from "@/generated";

hono.get("/kevin", (c) => {
  return c.text("kevin");
});

export { hono };
