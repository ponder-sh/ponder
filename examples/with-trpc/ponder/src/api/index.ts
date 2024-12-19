import { db } from "ponder:api";
import schema from "ponder:schema";
import { trpcServer } from "@hono/trpc-server";
import { initTRPC } from "@trpc/server";
import { Hono } from "hono";
import { eq } from "ponder";
import type { Address } from "viem";
import { z } from "zod";

const app = new Hono();
const t = initTRPC.create();

const appRouter = t.router({
  hello: t.procedure.input(z.string()).query(async ({ input }) => {
    const account = await db
      .select({ balance: schema.account.balance })
      .from(schema.account)
      .where(eq(schema.account.address, input as Address))
      .limit(1);

    if (account.length === 0) return null;
    return account[0]!.balance.toString();
  }),
});

export type AppRouter = typeof appRouter;

app.use("/trpc/*", trpcServer({ router: appRouter }));

export default app;
