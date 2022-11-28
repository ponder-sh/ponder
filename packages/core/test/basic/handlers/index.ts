const handleFileCreated = async () => {
  console.log("File created");
};

const handleFileDeleted = async () => {
  console.log("File deleted");
};

export default {
  FileStore: {
    FileCreated: handleFileCreated,
    FileDeleted: handleFileDeleted,
  },
};
