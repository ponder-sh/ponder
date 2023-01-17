import { mkdirSync } from "fs";
import net from "net";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildPonderConfig } from "@/buildPonderConfig";
import { buildOptions } from "@/common/options";
import { Ponder } from "@/Ponder";

const getFreePort = async () => {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const address = srv.address();
      if (typeof address === "string" || null)
        reject("Address null or missing port");
      const port = (address as net.AddressInfo).port;
      srv.close((err) => {
        if (err) reject(err);
        resolve(port);
      });
    });
  });
};

type PonderInstanceOptions = {
  networks: {
    name: string;
    chainId: number;
    rpcUrl: string;
  }[];
  sources: {
    name: string;
    network: string;
    abi: string | any[] | { abi: any[] };
    address: string;
    startBlock?: number;
    blockLimit?: number;
  }[];
  schema: string;
  handlers: string;
};

export const createPonderInstance = async (
  instanceOptions: PonderInstanceOptions
) => {
  const { networks, sources, schema, handlers } = instanceOptions;

  const dir = path.join(os.tmpdir(), Math.random().toString().slice(10));
  mkdirSync(path.join(dir, "handlers"), { recursive: true });

  const port = await getFreePort();
  const absoluteGraphqlPluginPath = path.resolve("../graphql/dist");

  const ponderTs = `
    import { graphqlPlugin } from "${absoluteGraphqlPluginPath}";
    
    export const config = () => {
      return {
        plugins: [graphqlPlugin({ port: ${port} })],
        networks: [ ${networks.map((network) => JSON.stringify(network))} ],
        sources: [ ${sources.map((source) => JSON.stringify(source))} ],
      };
    };
  `;
  writeFileSync(path.join(dir, "ponder.ts"), ponderTs);

  writeFileSync(path.join(dir, "handlers/index.ts"), handlers);
  writeFileSync(path.join(dir, "schema.graphql"), schema);

  const options = buildOptions({
    rootDir: dir,
    configFile: "ponder.ts",
    logType: "start",
    silent: true,
  });
  const config = await buildPonderConfig(options);
  return new Ponder({ options, config });
};
