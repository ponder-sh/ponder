import type { Common } from "@/internal/common.js";
import type { Plugin } from "vite";

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

if (globalThis.PONDER_INDEXING_BUILD === undefined || globalThis.PONDER_DATABASE === undefined) {
  throw new Error('Invalid dependency graph. Config, schema, and indexing function files cannot import objects from the API function file "src/api/index.ts".')
}

const publicClients = {};

for (let i = 0; i < globalThis.PONDER_INDEXING_BUILD.chains.length; i++) {
  const chain = globalThis.PONDER_INDEXING_BUILD.chains[i];
  const rpc = globalThis.PONDER_INDEXING_BUILD.rpcs[i];
  publicClients[chain.name] = createPublicClient({
    chain: chain.viemChain,
    transport: custom({
      request(body) {
        return rpc.request(body);
      }
    }),
  })
}

export const db = globalThis.PONDER_DATABASE.readonlyQB;
export { publicClients };
`;

export const vitePluginPonder = (options: Common["options"]): Plugin => {
  // On Windows, options.schemaFile is a Windows-style path. We need to convert it to a
  // Unix-style path for codegen, because TS import paths are Unix-style even on Windows.
  const schemaPath = options.schemaFile.replace(/\\/g, "/");

  return {
    name: "ponder",
    load: (id) => {
      if (id === "ponder:registry") return virtualModule();
      if (id === "ponder:schema") return schemaModule(schemaPath);
      if (id === "ponder:api") return apiModule();
      return null;
    },
  };
};
