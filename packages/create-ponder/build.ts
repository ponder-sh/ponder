import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import cpy from "cpy";

const root = import.meta.dir;

rmSync(path.join(root, "dist"), { recursive: true, force: true });

// Bundle the CLI into `dist/index.js`, leaving npm dependencies external.
const result = await Bun.build({
  entrypoints: [path.join(root, "src/index.ts")],
  outdir: path.join(root, "dist"),
  target: "node",
  format: "esm",
  packages: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

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
