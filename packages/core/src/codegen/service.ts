import { writeFileSync } from "node:fs";
import path from "node:path";

import { Emittery } from "@/utils/emittery.js";
import type { GraphQLSchema } from "graphql";
import { printSchema } from "graphql";

import type { Common } from "@/Ponder.js";
import { ensureDirExists } from "@/utils/exists.js";

export class CodegenService extends Emittery {
  private common: Common;

  constructor({ common }: { common: Common }) {
    super();
    this.common = common;
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
