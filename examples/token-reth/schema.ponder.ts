import { createSchema, createTable } from "@ponder/core";

export const schema = createSchema([
  createTable("Transfer")
    .addColumn("id", "string")
    .addColumn("sender", "string")
    .addColumn("receiver", "string")
    .addColumn("amount", "bigint")
    .addColumn("timestamp", "bigint")
    .addColumn("txHash", "string")
    .addColumn("blockNumber", "bigint")
    .addColumn("logIndex", "int"),
  createTable("Approval")
    .addColumn("id", "string")
    .addColumn("owner", "string")
    .addColumn("spender", "string")
    .addColumn("value", "bigint")
    .addColumn("timestamp", "bigint")
    .addColumn("txHash", "string")
    .addColumn("blockNumber", "bigint")
    .addColumn("logIndex", "int"),
]);
