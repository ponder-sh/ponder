import type { Common } from "@/common/common.js";
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

const apiModule = () => `export const db = global.PONDER_READONLY_DB;
`;

export const vitePluginPonder = (options: Common["options"]): Plugin => {
  return {
    name: "ponder",
    load: (id) => {
      if (id === "ponder:registry") return virtualModule();
      if (id === "ponder:schema") return schemaModule(options.schemaFile);
      if (id === "ponder:api") return apiModule();
      return null;
    },
  };
};
