import type { Prettify } from "@/types/utils.js";
import {
  type PGliteOptions as Options,
  PGlite,
  types,
} from "@electric-sql/pglite";

export type PGliteOptions = Prettify<Options & { dataDir: string }>;

export function createPglite(options: PGliteOptions) {
  // @ts-expect-error serializers is not a valid option yet
  return new PGlite({
    serializers: {
      [types.NUMERIC]: (x: string | number | bigint) => x.toString(),
    },
    parsers: { [types.NUMERIC]: (x: string) => BigInt(x) },
    ...options,
  });
}
