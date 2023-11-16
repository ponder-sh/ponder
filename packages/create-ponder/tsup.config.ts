import path from "node:path";
import { fileURLToPath } from "node:url";

import cpy from "cpy";
import { defineConfig } from "tsup";

import { dependencies } from "./package.json";

export default defineConfig({
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
        "!**/node_modules/**",
        "!**/generated/**",
        "!**/.ponder/**",
      ],
      targetPath,
      {
        filter: (file) => file.name !== ".env.local",
        rename: (name) => name.replace(/^\./, "_dot_"),
      },
    );

    await cpy(path.join(targetPath, "**", "_dot_env.example"), targetPath, {
      rename: "_dot_env.local",
    });
  },
});
