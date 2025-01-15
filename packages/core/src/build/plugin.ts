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

const apiModule = () => `import { createPublicClient } from "viem";

const publicClients = {};

for (const network of globalThis.PONDER_INDEXING_BUILD.networks) {
  publicClients[network.chainId] = createPublicClient({
    chain: network.chain,
    transport: () => network.transport
  })
}

export const db = globalThis.PONDER_DATABASE.qb.drizzleReadonly;
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
