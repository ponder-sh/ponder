import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import cpy from "cpy";

const root = import.meta.dir;

const examplesPath = path.join(root, "../..", "examples");
const targetPath = path.join(root, "templates");

// Copy examples contents into the templates path
await cpy(
  [
    path.join(examplesPath, "**", "*"),
    "!**/with-nextjs/**",
    "!**/with-foundry/**",
    "!**/with-trpc/**",
    "!**/with-client/**",
    "!**/with-offchain/**",
    "!**/node_modules/**",
    "!**/generated/**",
    "!**/.ponder/**",
  ],
  targetPath,
  {
    filter: (file) => file.name !== ".env.local",
    rename: (name) =>
      name === ".env.example" ? "_dot_env.local" : name.replace(/^\./, "_dot_"),
  },
);

readdirSync(targetPath)
  .filter((d) => d !== "default" && d !== "etherscan")
  .forEach((d) => {
    const contents = readFileSync(
      path.join(targetPath, d, "_dot_env.local"),
      "utf-8",
    );
    writeFileSync(
      path.join(targetPath, d, "_dot_env.local"),
      contents.replace(/PONDER_RPC_URL_(\d+)=.*/, "PONDER_RPC_URL_$1="),
    );
  });
