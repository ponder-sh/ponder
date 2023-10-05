import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export const ensureDirExists = async (filePath: string) => {
  const dirname = path.dirname(filePath);
  if (existsSync(dirname)) {
    return;
  }
  console.log("Directory does not exist");
  mkdirSync(dirname, { recursive: true });
};
