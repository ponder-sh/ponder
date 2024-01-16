import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Common } from "@/Ponder.js";
import { Emittery } from "@/utils/emittery.js";
import { ensureDirExists } from "@/utils/exists.js";
import type { GraphQLSchema } from "graphql";
import { printSchema } from "graphql";
import { ponderEnv } from "./ponderEnv.js";

export class CodegenService extends Emittery {
  private common: Common;

  constructor({ common }: { common: Common }) {
    super();
    this.common = common;
  }

  generatePonderEnv() {
    const filePath = path.join(this.common.options.rootDir, "ponder-env.d.ts");
    writeFileSync(filePath, ponderEnv, "utf8");

    this.common.logger.debug({
      service: "codegen",
      msg: "Wrote new file at ponder-env.d.ts",
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
      "schema.graphql",
    );
    ensureDirExists(filePath);
    writeFileSync(filePath, final, "utf8");

    this.common.logger.debug({
      service: "codegen",
      msg: "Wrote new file at generated/schema.graphql",
    });
  }
}
