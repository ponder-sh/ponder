import * as graphTsPonder from "@ponder/graph-ts-ponder";
import { Plugin } from "esbuild";

// This is an esbuild plugin that intercepts imports from @graphprotocol/graph-ts and replaces
// them with @ponder/graph-ts-ponder, where "Host" interfaces are implemented in Typescript.
const graphTsOverridePlugin: Plugin = {
  name: "@ponder/graph-ts-ponder",
  setup(build) {
    build.onResolve({ filter: /^@graphprotocol\/graph-ts$/ }, (args) => {
      console.log("redirecting to @ponder/graph-ts-ponder");
      return { path: "@ponder/graph-ts-ponder" };
    });

    // // When loading imports from "@graphprotocol/graph-ts"...
    // build.onLoad({ filter: /^@graphprotocol\/graph-ts$/ }, (args) => {
    //   console.log("in onLoad");
    //   console.log({ path: args.path });

    //   const result = build.esbuild.build({
    //     entryPoints: ["app.js"],
    //     bundle: true,
    //     write: false,
    //   });

    //   // build.resolve();

    //   return {
    //     contents: JSON.stringify(process.env),
    //     loader: "ts",
    //   };
    // });
  },
};

export { graphTsOverridePlugin };
