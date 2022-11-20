import { ethers } from "ethers";

import { FileCreatedHandler, FileDeletedHandler } from "../generated/handlers";

const parseJson = (encodedJson: string, defaultValue: any = null) => {
  try {
    return JSON.parse(encodedJson);
  } catch (e) {
    return defaultValue;
  }
};

const handleFileCreated: FileCreatedHandler = async (event, context) => {
  const { filename, size, metadata: rawMetadata } = event.params;

  const metadata = parseJson(ethers.utils.toUtf8String(rawMetadata));

  await context.entities.File.insert({
    id: filename,
    name: filename,
    size: size.toNumber(),
    contents: await context.contracts.FileStoreFrontend.readFile(
      event.address as `0x{string}`,
      filename,
      {
        blockTag: event.block.number,
      }
    ),
    createdAt: event.block.timestamp,
    type: metadata?.type,
    compression: metadata?.compression,
    encoding: metadata?.encoding,
  });
};

const handleFileDeleted: FileDeletedHandler = async (event, context) => {
  await context.entities.File.delete(event.params.filename);
};

export const FileStore = {
  FileCreated: handleFileCreated,
  FileDeleted: handleFileDeleted,
};
