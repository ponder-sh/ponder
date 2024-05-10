import { ponder } from "@/generated";

ponder.on("multicall3.aggregate3()", async ({ event, context }) => {
  console.log(event.args);
});
