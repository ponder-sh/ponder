// @ts-ignore
import { ponder } from "@/generated";
import * as schema from "../ponder.schema.js";

// biome-ignore lint/suspicious/noRedeclare: :)
declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js")
>;

ponder.on(
  "Erc20:Transfer(address indexed from, address indexed to, uint256 amount)",
  async ({ event, context }) => {
    await context.db
      .insert(schema.account)
      .values({
        address: event.args.from,
        balance: -event.args.amount,
      })
      .onConflictDoUpdate((row) => ({
        balance: row.balance - event.args.amount,
      }));

    await context.db
      .insert(schema.account)
      .values({
        address: event.args.to,
        balance: event.args.amount,
      })
      .onConflictDoUpdate((row) => ({
        balance: row.balance + event.args.amount,
      }));
  },
);
