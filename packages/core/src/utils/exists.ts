import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";

export const ensureDirExists = (filePath: string) => {
  const dirname = path.dirname(filePath);
  if (existsSync(dirname)) {
    return;
  }
  mkdirSync(dirname, { recursive: true });
};
