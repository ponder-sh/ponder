import { mkdirSync } from "node:fs";
import { type PGliteOptions as Options, PGlite } from "@electric-sql/pglite";
import type { Prettify } from "@/types/utils.js";

export type PGliteOptions = Prettify<Options & { dataDir: string }>;

export function createPglite(options: PGliteOptions) {
  // PGlite uses the memory FS by default, and Windows doesn't like the
  // "memory://" path, so it's better to pass `undefined` here.
  if (options.dataDir === "memory://") {
    const { dataDir: _, ...pgliteOptions } = options;
    return new PGlite(pgliteOptions);
  }

  mkdirSync(options.dataDir, { recursive: true });
  return new PGlite(options);
}
