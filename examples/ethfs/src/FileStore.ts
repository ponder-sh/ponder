import { fromHex } from "viem";

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

  const metadata = parseJson(fromHex(rawMetadata, "string"));

  await context.entities.File.create({
    id: filename,
    data: {
      name: filename,
      size: Number(size),
      contents: "124443333",
      // await context.contracts.FileStoreFrontend.readFile(
      //   event.transaction.to as `0x{string}`,
      //   filename
      // ),
      createdAt: Number(event.block.timestamp),
      type: metadata?.type,
      compression: metadata?.compression,
      encoding: metadata?.encoding,
    },
  });
});

ponder.on("FileStore:FileDeleted", async ({ event, context }) => {
  await context.entities.File.delete({ id: event.params.filename });
});
