declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js")
>;

declare const schema: typeof import("../ponder.schema.js");

// @ts-expect-error
// biome-ignore lint/suspicious/noRedeclare: Generated registry imports intentionally shadow the local declarations.
import { ponder } from "ponder:registry";
// @ts-expect-error
// biome-ignore lint/suspicious/noRedeclare: Generated registry imports intentionally shadow the local declarations.
import schema from "ponder:schema";

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
