import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import type { Hex } from "viem";
import { fromHex } from "viem";
import { FileStoreFrontendAbi } from "../abis/FileStoreFrontendAbi";

const parseJson = (encodedJson: string, defaultValue: any = null) => {
  try {
    return JSON.parse(encodedJson);
  } catch (e) {
    return defaultValue;
  }
};

ponder.on("FileStore:FileCreated", async ({ event, context }) => {
  const { filename, size, metadata: rawMetadata } = event.args;

  const metadata = parseJson(fromHex(rawMetadata as Hex, "string"));

  await context.db.insert(schema.file).values({
    name: filename,
    size: Number(size),
    contents: await context.client.readContract({
      abi: FileStoreFrontendAbi,
      functionName: "readFile",
      address: "0xBc66C61BCF49Cc3fe4E321aeCEa307F61EC57C0b",
      args: [event.transaction.to!, filename],
    }),
    createdAt: Number(event.block.timestamp),
    type: metadata?.type,
    compression: metadata?.compression,
    encoding: metadata?.encoding,
  });
});

ponder.on("FileStore:FileDeleted", async ({ event, context }) => {
  await context.db.delete(schema.file, { name: event.args.filename });
});
