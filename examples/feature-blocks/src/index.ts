import { ponder } from "@/generated";
import { parseAbi } from "viem";
import * as schema from "../ponder.schema";

ponder.on("ChainlinkPriceOracle:block", async ({ event, context }) => {
  const price = await context.client.readContract({
    address: "0xD10aBbC76679a20055E167BB80A24ac851b37056",
    abi: parseAbi(["function latestAnswer() external view returns (int256)"]),
    functionName: "latestAnswer",
  });

  await context.db.insert(schema.chainlinkPrice).values({
    timestamp: event.block.timestamp,
    price: Number(price) / 10 ** 8,
  });
});
