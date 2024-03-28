import path from "node:path";
import type { Common } from "@/common/common.js";
import MagicString from "magic-string";
import type { Plugin } from "vite";
import { SERVER_FILE } from "./service.js";

export const ponderRegex =
  /^import\s+\{[^}]*\bponder\b[^}]*\}\s+from\s+["']@\/generated["'];?.*$/gm;

export const serverRegex =
  /^import\s+\{[^}]*\bserver\b[^}]*\}\s+from\s+["']@\/generated["'];?.*$/gm;

export const ponderShim = `export let ponder = {
  fns: [],
  on(name, fn) {
    this.fns.push({ name, fn });
  },
};
`;

export const serverShim = `import { Hono } from "hono";
export const server = new Hono();
`;

export function replaceStateless(code: string, regex: RegExp, shim: string) {
  const s = new MagicString(code);
  // MagicString.replace calls regex.exec(), which increments `lastIndex`
  // on a match. We have to set this back to zero to use the same regex
  // multiple times.
  regex.lastIndex = 0;
  s.replace(regex, shim);
  return s;
}

export const vitePluginPonder = (common: Common): Plugin => {
  return {
    name: "ponder",
    transform: (code, id) => {
      if (
        id === path.join(common.options.srcDir, SERVER_FILE) &&
        serverRegex.test(code)
      ) {
        const s = replaceStateless(code, serverRegex, serverShim);
        const transformed = s.toString();
        const sourcemap = s.generateMap({ source: id });
        return { code: transformed, map: sourcemap };
      } else if (ponderRegex.test(code)) {
        const s = replaceStateless(code, ponderRegex, ponderShim);
        const transformed = s.toString();
        const sourcemap = s.generateMap({ source: id });
        return { code: transformed, map: sourcemap };
      } else {
        return null;
      }
    },
  };
};
