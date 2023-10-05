const { createSchema, createTable } = require("@ponder/core");

exports.schema = createSchema([
  createTable("Transfer")
    .addColumn("id", "string")
    .addColumn("sender", "string")
    .addColumn("receiver", "string")
    .addColumn("amount", "bigint")
    .addColumn("timestamp", "bigint")
    .addColumn("txHash", "string")
    .addColumn("blockNumber", "bigint")
    .addColumn("logIndex", "number"),
  createTable("Approval")
    .addColumn("id", "string")
    .addColumn("owner", "string")
    .addColumn("spender", "string")
    .addColumn("value", "bigint")
    .addColumn("timestamp", "bigint")
    .addColumn("txHash", "string")
    .addColumn("blockNumber", "bigint")
    .addColumn("logIndex", "number"),
]);
