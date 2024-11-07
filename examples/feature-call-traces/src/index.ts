import { ponder } from "@/generated";
import * as schema from "../ponder.schema";

ponder.on("multicall3.aggregate3()", async ({ event, context }) => {
  await context.db
    .insert(schema.multicall)
    .values({
      from: event.trace.from,
      gasUsed: event.trace.gasUsed,
      bytes: event.args[0].reduce<number>(
        (acc, cur) => acc + Math.ceil((cur.callData.length - 2) / 8),
        0,
      ),
      successfulCalls: event.result.filter(({ success }) => success === true)
        .length,
      failedCalls: event.result.filter(({ success }) => success === false)
        .length,
    })
    .onConflictDoUpdate((row) => ({
      gasUsed: row.gasUsed + event.trace.gasUsed,
      bytes:
        row.bytes +
        event.args[0].reduce<number>(
          (acc, cur) => acc + Math.ceil((cur.callData.length - 2) / 8),
          0,
        ),
      successfulCalls:
        row.successfulCalls +
        event.result.filter(({ success }) => success === true).length,
      failedCalls:
        row.failedCalls +
        event.result.filter(({ success }) => success === false).length,
    }));
});
