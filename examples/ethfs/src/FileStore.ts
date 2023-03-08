import { ethers } from "ethers";

import { ponder } from "@/generated";

const parseJson = (encodedJson: string, defaultValue: any = null) => {
  try {
    return JSON.parse(encodedJson);
  } catch (e) {
    return defaultValue;
  }
};

ponder.on("FileStore:FileCreated", async ({ event, context }) => {
  const { filename, size, metadata: rawMetadata } = event.params;

  const metadata = parseJson(ethers.utils.toUtf8String(rawMetadata));

  await context.entities.File.upsert(filename, {
    name: filename,
    size: size.toNumber(),
    contents: await context.contracts.FileStoreFrontend.readFile(
      event.transaction.to as `0x{string}`,
      filename,
      {
        blockTag: event.block.number,
      }
    ),
    createdAt: Number(event.block.timestamp),
    type: metadata?.type,
    compression: metadata?.compression,
    encoding: metadata?.encoding,
  });
});

ponder.on("FileStore:FileDeleted", async ({ event, context }) => {
  await context.entities.File.delete(event.params.filename);
});
