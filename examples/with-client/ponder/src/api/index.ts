import { type ApiContext, ponder } from "ponder:registry";
import schema from "ponder:schema";
import { trpcServer } from "@hono/trpc-server";
import { initTRPC } from "@trpc/server";
import { eq } from "ponder";
import type { Address } from "viem";
import { z } from "zod";

const t = initTRPC.context<ApiContext>().create();

const appRouter = t.router({
  hello: t.procedure.input(z.string()).query(async ({ input, ctx }) => {
    const account = await ctx.db
      .select({ balance: schema.account.balance })
      .from(schema.account)
      .where(eq(schema.account.address, input as Address))
      .limit(1);

    if (account.length === 0) return null;
    return account[0]!.balance.toString();
  }),
});

export type AppRouter = typeof appRouter;

ponder.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_, c) => c.var,
  }),
);
