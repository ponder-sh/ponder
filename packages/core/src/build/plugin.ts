import type { Common } from "@/common/common.js";
import type { Plugin } from "vite";

const virtualModule = (command: Common["options"]["command"]) => `import { Hono } from "hono";
import crypto from "node:crypto";

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

const instanceId = "${command}" === "serve" ? undefined : crypto.randomBytes(2).toString("hex");

const ponder = {
  ...ponderHono,
  hono: new Hono(),
  fns: [],
  on(name, fn) {
    this.fns.push({ name, fn });
  },
};

export { ponder, instanceId };
`;

export const vitePluginPonder = (common: Common): Plugin => {
  return {
    name: "ponder",
    load: (id) => {
      if (id === "@/generated") return virtualModule(common.options.command);
      return null;
    },
  };
};
