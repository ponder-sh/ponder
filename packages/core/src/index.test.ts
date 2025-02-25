import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, test } from "vitest";

let __dirname = fileURLToPath(new URL(".", import.meta.url));
__dirname = path.resolve(__dirname, "..");

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
      build: {
        write: false,
        lib: {
          entry: path.resolve(__dirname, "./src/index.ts"),
          name: "ponder",
          formats: ["es"],
        },
      },
    }),
  ).resolves.toBeDefined();
});
