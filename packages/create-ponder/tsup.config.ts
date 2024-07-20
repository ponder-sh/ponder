import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cpy from "cpy";
import { defineConfig } from "tsup";

import { dependencies } from "./package.json";

export default defineConfig({
  name: "create-ponder",
  bundle: true,
  clean: true,
  entry: ["src/index.ts"],
  external: Object.keys(dependencies),
  format: ["esm"],
  platform: "node",
  async onSuccess() {
    const __dirname = fileURLToPath(new URL(".", import.meta.url));
    const examplesPath = path.join(__dirname, "../..", "examples");
    const targetPath = path.join(__dirname, "templates");

    // Copy examples contents into the templates path
    await cpy(
      [
        path.join(examplesPath, "**", "*"),
        "!**/with-nextjs/**",
        "!**/with-foundry/**",
        "!**/with-trpc/**",
        "!**/node_modules/**",
        "!**/generated/**",
        "!**/.ponder/**",
      ],
      targetPath,
      {
        filter: (file) => file.name !== ".env.local",
        rename: (name) =>
          name === ".env.example"
            ? "_dot_env.local"
            : name.replace(/^\./, "_dot_"),
      },
    );

    readdirSync(targetPath)
      .filter((d) => d !== "default" && d !== "etherscan")
      .map((d) => {
        const contents = readFileSync(
          path.join(targetPath, d, "_dot_env.local"),
          "utf-8",
        );
        writeFileSync(
          path.join(targetPath, d, "_dot_env.local"),
          contents.replace(/PONDER_RPC_URL_(\d+)=.*/, "PONDER_RPC_URL_$1="),
        );
      });
  },
});
