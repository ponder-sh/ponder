import type { Common } from "@/common/common.js";
import type { Plugin } from "vite";

const virtualModule = () => `import { Hono } from "hono";

const ponderHono = {
  routes: [],
  get(...maybePathOrHandlers) {
    this.routes.push({ method: "GET", pathOrHandlers: maybePathOrHandlers });
    return this;
  },
  post(...maybePathOrHandlers) {
    this.routes.push({ method: "POST", pathOrHandlers: maybePathOrHandlers });
    return this;
  },
  use(...maybePathOrHandlers) {
    this.routes.push({ method: "USE", pathOrHandlers: maybePathOrHandlers });
    return this;
  },
};

const ponder = {
  ...ponderHono,
  hono: new Hono(),
  fns: [],
  on(name, fn) {
    this.fns.push({ name, fn });
  },
};

export { ponder };
`;

const schemaModule = (
  schemaPath: string,
) => `import * as schema from "${schemaPath}";
export * from "${schemaPath}";
export default schema;
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
      return null;
    },
  };
};
