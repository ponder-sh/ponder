import type { Plugin } from "vite";
import type { Options } from "@/internal/options.js";
import type { Schema } from "@/internal/types.js";
import type { RequestParameters } from "@/rpc/index.js";
import type { Drizzle } from "@/types/db.js";

/**
 * Values for the `ponder:api` virtual module, from the services of the API
 * build.
 *
 * @dev The module runs in the user's project, which can't import `effect`, so
 * RPC requests return promises.
 */
export type ApiModule = {
  /** The readonly Drizzle database. */
  db: Drizzle<Schema>;
  /** The RPC request of each chain in `PONDER_INDEXING_BUILD`. */
  requests: ((body: RequestParameters) => Promise<unknown>)[];
};

const virtualModule = () => `export const ponder = {
  fns: [],
  on(name, fn) {
    this.fns.push({ name, fn });
  },
};
`;

const schemaModule = (
  schemaPath: string,
) => `import * as schema from "${schemaPath}";
export * from "${schemaPath}";
export default schema;
`;

const apiModule = () => `import { createPublicClient, custom } from "viem";

if (globalThis.PONDER_INDEXING_BUILD === undefined || globalThis.PONDER_API_MODULE === undefined) {
  throw new Error('Invalid dependency graph. Config, schema, and indexing function files cannot import objects from the API function file "src/api/index.ts".')
}

const publicClients = {};

for (let i = 0; i < globalThis.PONDER_INDEXING_BUILD.chains.length; i++) {
  const chain = globalThis.PONDER_INDEXING_BUILD.chains[i];
  const request = globalThis.PONDER_API_MODULE.requests[i];
  publicClients[chain.name] = createPublicClient({
    chain: chain.viemChain,
    transport: custom({
      request(body) {
        return request(body);
      }
    }),
  })
}

export const db = globalThis.PONDER_API_MODULE.db;
export { publicClients };
`;

export const vitePluginPonder = (options: Options["Service"]): Plugin => {
  // On Windows, options.schemaFile is a Windows-style path. We need to convert it to a
  // Unix-style path for codegen, because TS import paths are Unix-style even on Windows.
  const schemaPath = options.schemaFile.replace(/\\/g, "/");

  return {
    name: "ponder",
    resolveId: (id) => {
      if (id === "ponder:registry") return id;
      if (id === "ponder:schema") return id;
      if (id === "ponder:api") return id;
      return null;
    },
    load: (id) => {
      if (id === "ponder:registry") return virtualModule();
      if (id === "ponder:schema") return schemaModule(schemaPath);
      if (id === "ponder:api") return apiModule();
      return null;
    },
  };
};
