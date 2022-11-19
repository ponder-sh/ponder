import { FileCreatedHandler, FileDeletedHandler } from "../generated/handlers";

const handleFileCreated: FileCreatedHandler = async (event, context) => {
  console.log("File created");

  console.log({ params: event.params });
  return;
};

const handleFileDeleted: FileDeletedHandler = async (event, context) => {
  console.log("File deleted");

  return;
};

export const FileStore = {
  FileCreated: handleFileCreated,
  FileDeleted: handleFileDeleted,
};
