import Emittery from "emittery";
import type { GraphQLSchema } from "graphql";
import { printSchema } from "graphql";
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Common } from "@/Ponder.js";
import { ensureDirExists } from "@/utils/exists.js";

export class CodegenService extends Emittery {
  private common: Common;

  constructor({ common }: { common: Common }) {
    super();
    this.common = common;
  }

  generateDeclarationFile() {
    const getImportPath = (file: string) => {
      let relative = path.relative(this.common.options.rootDir, file);

      // If the file is in the same directory, prepend with "./"
      if (!relative.startsWith("..") && !path.isAbsolute(relative))
        relative = `./${relative}`;

      return relative;
    };

    const configPath = getImportPath(this.common.options.configFile);
    const schemaPath = getImportPath(this.common.options.schemaFile);

    const contents = `declare module "@/generated" {
  import type { PonderApp } from "@ponder/core";

  export const ponder: PonderApp<
    typeof import("${configPath}").config,
    typeof import("${schemaPath}").schema
  >;
}
`;

    const filePath = path.join(this.common.options.rootDir, "ponder-env.d.ts");
    writeFileSync(filePath, contents, "utf8");

    this.common.logger.debug({
      service: "codegen",
      msg: `Generated ponder-env.d.ts`,
    });
  }

  generateGraphqlSchemaFile({
    graphqlSchema,
  }: {
    graphqlSchema: GraphQLSchema;
  }) {
    const final = printSchema(graphqlSchema);

    const filePath = path.join(
      this.common.options.generatedDir,
      "schema.graphql"
    );
    ensureDirExists(filePath);
    writeFileSync(filePath, final, "utf8");

    this.common.logger.debug({
      service: "codegen",
      msg: `Wrote new file at generated/schema.graphql`,
    });
  }
}
