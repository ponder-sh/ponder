import Emittery from "emittery";
import { GraphQLSchema, printSchema } from "graphql";
import { writeFileSync } from "node:fs";
import path from "node:path";

import type { Common } from "@/Ponder";
import { ensureDirExists } from "@/utils/exists";

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
