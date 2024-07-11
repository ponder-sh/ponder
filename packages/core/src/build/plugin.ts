import MagicString from "magic-string";
import type { Plugin } from "vite";

export const ponderRegex =
  /^import\s+\{[^}]*\bponder\b[^}]*\}\s+from\s+["']@\/generated["'];?.*$/gm;

export const shim = `import { Hono } from "hono";

let __ponderHono = {
  routes: [],
  get(...maybePathOrHandlers) {
    this.routes.push({method: "GET", pathOrHandlers: maybePathOrHandlers});
    return this;
  },
  post(...maybePathOrHandlers) {
    this.routes.push({method: "POST", pathOrHandlers: maybePathOrHandlers});
    return this;
  },
  use(...maybePathOrHandlers) {
    this.routes.push({method: "USE", pathOrHandlers: maybePathOrHandlers});
    return this;
  } 
}

export let ponder = {
  hono: new Hono(),
  ...__ponderHono,
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
