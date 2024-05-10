import { ponder } from "@/generated";

ponder.on("multicall3.aggregate3()", async ({ event, context }) => {
  await context.db.multicalls.upsert({
    id: event.trace.from,
    create: {
      gasUsed: event.trace.gasUsed,
      bytes: event.args[0].reduce<number>(
        (acc, cur) => acc + Math.ceil((cur.callData.length - 2) / 8),
        0,
      ),
      successfulCalls: event.result.filter(({ success }) => success === true)
        .length,
      failedCalls: event.result.filter(({ success }) => success === false)
        .length,
    },
    update: ({ current }) => ({
      gasUsed: current.gasUsed + event.trace.gasUsed,
      bytes:
        current.bytes +
        event.args[0].reduce<number>(
          (acc, cur) => acc + Math.ceil((cur.callData.length - 2) / 8),
          0,
        ),
      successfulCalls:
        current.successfulCalls +
        event.result.filter(({ success }) => success === true).length,
      failedCalls:
        current.failedCalls +
        event.result.filter(({ success }) => success === false).length,
    }),
  });
});
