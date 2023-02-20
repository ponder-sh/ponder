import cors from "cors";
import express from "express";
import { graphqlHTTP } from "express-graphql";
import type http from "node:http";

import type { Ponder } from "@/Ponder";

import { buildGqlSchema } from "./graphql/buildGqlSchema";

export class Server {
  ponder: Ponder;

  app: express.Express;
  server: http.Server;
  graphqlMiddleware?: express.Handler;

  constructor({ ponder }: { ponder: Ponder }) {
    this.ponder = ponder;

    this.app = express();
    this.app.use(cors());
    this.server = this.app.listen(ponder.options.PORT);
  }

  reload() {
    if (!this.ponder.schema) return;
    const graphqlSchema = buildGqlSchema(this.ponder.schema);

    // This uses a small hack to update the GraphQL server on the fly.
    this.graphqlMiddleware = graphqlHTTP({
      schema: graphqlSchema,
      context: {
        store: this.ponder.entityStore,
      },
      graphiql: true,
    });

    this.app.get("/", (req, res) => res.redirect(302, "/graphql"));
    this.app.use("/graphql", (...args) => this.graphqlMiddleware?.(...args));
  }

  teardown() {
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

// export type PonderGraphqlPluginOptions = {
//   port?: number;
// };

// export const graphqlPlugin: PonderPluginBuilder<PonderGraphqlPluginOptions> = (
//   options = {}
// ) => {
//   return (ponder: Ponder) => new PonderGraphqlPlugin(ponder, options);
// };

// class PonderGraphqlPlugin implements PonderPlugin {
//   ponder: Ponder;
//   name = "graphql";

//   port: number;
//   server?: GraphqlServer;

//   constructor(ponder: Ponder, options: PonderGraphqlPluginOptions) {
//     this.ponder = ponder;

//     if (process.env.PORT) {
//       this.port = parseInt(process.env.PORT);
//     } else if (options.port) {
//       this.port = options.port;
//     } else {
//       this.port = 42069;
//     }
//   }

//   setup = async () => {
//     if (!this.ponder.schema) {
//       return;
//     }

//     const gqlSchema = buildGqlSchema(this.ponder.schema);

//     // Build Express GraphQL server
//     this.server = new GraphqlServer(
//       this.port,
//       this.ponder.entityStore,
//       this.ponder.logger
//     );
//     this.server.start(gqlSchema, this.port);

//     await generateSchemaTypes(gqlSchema, this.ponder);
//     generateSchema(gqlSchema, this.ponder);
//   };

//   reload = async () => {
//     if (!this.ponder.schema) {
//       return;
//     }

//     const gqlSchema = buildGqlSchema(this.ponder.schema);

//     this.server?.start(gqlSchema, this.port);
//   };

//   teardown = async () => {
//     this.server?.teardown();
//   };
// }
