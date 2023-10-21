import glob from "glob";
import path from "node:path";
import url from "node:url";

import { Runtime } from "../runtime.mjs";

/**
 * Node.js LTS (20):
 * `node --import=tsx runner.mts`
 * Node.js 18:
 * `node --loader=tsx runner.mts`
 * Or as JS file:
 * `node runner.mjs`
 */

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const files = glob.sync(
  path.resolve(__dirname, "./lorem/*.{js,cjs,mjs,ts,mts,tsx}")
);

const runtime = new Runtime({
  files,
  viteServerConfig: {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  },
});
runtime.start(async (module, filePath) => {
  if (__filename === filePath) return; // ignore changes to this file

  const { default: MyClass } = await module;
  const mod = new MyClass();
  const params = mod.getParams();

  console.log(JSON.stringify(params, undefined, 2));
});
