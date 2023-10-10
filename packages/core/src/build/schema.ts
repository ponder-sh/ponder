import { build } from "esbuild";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { Schema } from "@/schema/types";
import { ensureDirExists } from "@/utils/exists";

export const buildSchema = async ({ schemaFile }: { schemaFile: string }) => {
  if (!existsSync(schemaFile)) {
    throw new Error(`Ponder schema file not found, expected: ${schemaFile}`);
  }

  const buildFile = path.join(path.dirname(schemaFile), "__ponderSchema__.js");
  ensureDirExists(buildFile);

  // Delete the build file before attempting to write it.
  rmSync(buildFile, { force: true });

  try {
    await build({
      entryPoints: [schemaFile],
      outfile: buildFile,
      platform: "node",
      format: "cjs",
      bundle: false,
      logLevel: "silent",
    });

    const { default: rawDefault, schema: rawSchema } = require(buildFile);
    rmSync(buildFile, { force: true });

    if (!rawSchema) {
      if (rawDefault) {
        throw new Error(
          `Ponder schema not found. ${path.basename(
            schemaFile
          )} must export a variable named "schema" (Cannot be a default export)`
        );
      }
      throw new Error(
        `Ponder schema not found. ${path.basename(
          schemaFile
        )} must export a variable named "schema"`
      );
    }

    let resolvedSchema: Schema;

    if (typeof rawSchema === "function") {
      resolvedSchema = await rawSchema();
    } else {
      resolvedSchema = await rawSchema;
    }

    return resolvedSchema;
  } catch (err) {
    rmSync(buildFile, { force: true });
    throw err;
  }
};
