import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, test } from "vitest";

let __dirname = fileURLToPath(new URL(".", import.meta.url));
__dirname = path.resolve(__dirname, "..");

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "./package.json"), "utf-8"),
);
const dependencies = Object.keys(packageJson.dependencies).filter(
  (dep) => !["@ponder/client", "@ponder/utils"].includes(dep),
);

test("should bundle the entry file for the browser without throwing", async () => {
  await expect(
    build({
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./src"),
          "@ponder/client": path.resolve(__dirname, "../client/src"),
          "@ponder/utils": path.resolve(__dirname, "../utils/src"),
        },
      },
      // Mock build settings
      logLevel: "error",
      build: {
        lib: {
          entry: path.resolve(__dirname, "./src/index.ts"),
          name: "ponder",
          formats: ["es"],
        },
        // Speed up the build
        write: false,
        minify: false,
        reportCompressedSize: false,
        sourcemap: false,
        // Exclude all dependencies
        rollupOptions: { external: dependencies },
      },
    }),
  ).resolves.toBeDefined();
});
