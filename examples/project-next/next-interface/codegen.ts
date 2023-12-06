import type { CodegenConfig } from "@graphql-codegen/cli";

const config = {
  avoidOptionals: true,
  immutableTypes: true,
  defaultScalarType: "string",
};

const codegenConfig: CodegenConfig = {
  generates: {
    "./src/graphql/generated/": {
      schema: "../ponder/generated/schema.graphql",
      documents:
        "/Users/kylescott/src/ponder/examples/project-next/next-interface/src/graphql/balance.graphql",
      preset: "client",
      config,
      plugins: [],
    },
  },
};
export default codegenConfig;
