import { type ApiContext, ponder } from "@/generated";
import { trpcServer } from "@hono/trpc-server";
import { eq } from "@ponder/core";
import { initTRPC } from "@trpc/server";
import type { Address } from "viem";
import { z } from "zod";

const t = initTRPC.context<ApiContext>().create();

const appRouter = t.router({
  hello: t.procedure.input(z.string()).query(async ({ input, ctx }) => {
    const { Account } = ctx.tables;

    const account = await ctx.db
      .select({ balance: Account.balance })
      .from(Account)
      .where(eq(Account.id, input as Address))
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
