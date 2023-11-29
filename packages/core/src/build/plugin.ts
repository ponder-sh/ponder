import MagicString from "magic-string";
import type { Plugin } from "vite";

export const regex =
  /^import\s+\{[^}]*\bponder\b[^}]*\}\s+from\s+["']@\/generated["'];?.*$/gm;

export const shim = `export let ponder = {
  fns: [],
  on(name, fn) {
    this.fns.push({ name, fn });
  },
};
`;

export function replaceStateless(code: string) {
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
      if (regex.test(code)) {
        const s = replaceStateless(code);
        const transformed = s.toString();
        const sourcemap = s.generateMap({ source: id });
        return { code: transformed, map: sourcemap };
      } else {
        return null;
      }
    },
  };
};
