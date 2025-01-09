import { mkdirSync } from "node:fs";
import type { Prettify } from "@/types/utils.js";
import { type PGliteOptions as Options, PGlite } from "@electric-sql/pglite";

export type PGliteOptions = Prettify<Options & { dataDir: string }>;

export function createPglite(options: PGliteOptions) {
  // PGlite uses the memory FS by default, and Windows doesn't like the
  // "memory://" path, so it's better to pass `undefined` here.
  if (options.dataDir === "memory://") {
    // @ts-expect-error
    options.dataDir = undefined;
  } else {
    mkdirSync(options.dataDir, { recursive: true });
  }

  return new PGlite(options);
}
