import MagicString from "magic-string";
import type { Plugin } from "vite";

export const ponderRegex =
  /^import\s+\{[^}]*\bponder\b[^}]*\}\s+from\s+["']@\/generated["'];?.*$/gm;

export const shim = `import { Hono } from "hono";
let __hono__ = new Hono();
export let ponder = {
  hono: __hono__,
  get: __hono__.get,
  post: __hono__.get,
  use: __hono__.use,
  fns: [],
  on(name, fn) {
    this.fns.push({ name, fn });
  },
};
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

export const vitePluginPonder = (): Plugin => {
  return {
    name: "ponder",
    transform: (code, id) => {
      if (ponderRegex.test(code)) {
        const s = replaceStateless(code, ponderRegex, shim);
        const transformed = s.toString();
        const sourcemap = s.generateMap({ source: id });
        return { code: transformed, map: sourcemap };
      }
      return null;
    },
  };
};
