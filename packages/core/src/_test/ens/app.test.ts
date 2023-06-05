import { rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, expect, test, TestContext } from "vitest";

import { testNetworkConfig } from "@/_test/utils";
import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { Ponder } from "@/Ponder";

const setup = async ({ context }: { context: TestContext }) => {
  const config = await buildPonderConfig({
    configFile: path.resolve("src/_test/ens/app/ponder.config.ts"),
  });
  // Inject proxied anvil chain.
  const testConfig = { ...config, networks: [testNetworkConfig] };

  const options = buildOptions({
    cliOptions: {
      rootDir: "./src/_test/ens/app",
      configFile: "ponder.config.ts",
    },
  });
  const testOptions = { ...options, uiEnabled: false, logLevel: 1 };

  const ponder = new Ponder({
    config: testConfig,
    options: testOptions,
    eventStore: context.eventStore,
    userStore: context.userStore,
  });

  await ponder.start();

  // Wait for historical sync event processing to complete.
  await new Promise<void>((resolve) => {
    ponder.eventHandlerService.on("eventsProcessed", ({ toTimestamp }) => {
      // Block 16370050
      if (toTimestamp >= 1673277023) {
        resolve();
      }
    });
  });

  const gql = async (query: string) => {
    const response = await request(ponder.serverService.app)
      .post("/")
      .send({ query: `query { ${query} }` });

    expect(response.body.errors).toBe(undefined);
    expect(response.statusCode).toBe(200);

    return response.body.data;
  };

  return { ponder, gql };
};

afterEach(() => {
  rmSync("./src/_test/ens/app/.ponder", { recursive: true, force: true });
  rmSync("./src/_test/ens/app/generated", { recursive: true, force: true });
});

test("serves data", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts, accounts } = await gql(`
    ensNfts {
      id
      labelHash
      owner {
        id
      }
      transferredAt
    }
    accounts {
      id
      lastActive
      tokens {
        id
      }
    }
  `);

  expect(ensNfts).toHaveLength(13);
  expect(accounts).toHaveLength(19);

  await ponder.kill();
});

test("returns string array types", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts {
      id
      stringArray
    }
  `);

  expect(ensNfts[0].stringArray).toEqual(["123", "abc"]);

  await ponder.kill();
});

test("returns int array types", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts {
      id
      intArray
    }
  `);

  expect(ensNfts[0].intArray).toEqual([123, 456]);

  await ponder.kill();
});

test("limits", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(first: 2) {
      id
    }
  `);

  expect(ensNfts).toHaveLength(2);

  await ponder.kill();
});

test("skips", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(skip: 5) {
      id
    }
  `);

  expect(ensNfts).toHaveLength(8);

  await ponder.kill();
});

test("orders ascending", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(orderBy: "transferredAt", orderDirection: "asc") {
      id
      transferredAt
    }
  `);

  expect(ensNfts.length).toBeGreaterThan(0);
  expect(ensNfts).toBe(
    ensNfts.sort((a: any, b: any) => a.transferredAt - b.transferredAt)
  );

  await ponder.kill();
});

test("orders descending", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(orderBy: "transferredAt", orderDirection: "desc") {
      id
      transferredAt
    }
  `);

  expect(ensNfts.length).toBeGreaterThan(0);
  expect(ensNfts).toBe(
    ensNfts.sort((a: any, b: any) => b.transferredAt - a.transferredAt)
  );

  await ponder.kill();
});

test("filters on integer field equals", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(where: { transferredAt: 1673276483 }) {
      id
      transferredAt
    }
  `);

  expect(ensNfts).toHaveLength(1);
  expect(ensNfts[0].transferredAt).toBe(1673276483);

  await ponder.kill();
});

test("filters on integer field in", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(where: { transferredAt_in: [1673276483, 1673276555] }) {
      id
      transferredAt
    }
  `);

  expect(ensNfts).toHaveLength(2);
  const transferredAt = ensNfts.map((n: any) => n.transferredAt);
  expect(transferredAt).toContain(1673276483);
  expect(transferredAt).toContain(1673276555);

  await ponder.kill();
});

test("filters on string field equals", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(where: { labelHash: "0x6707d6843139c46c28b1bb912334ca1b748756e534771639e627f401ca658c0e" }) {
      id
      labelHash
    }
  `);

  expect(ensNfts).toHaveLength(1);
  expect(ensNfts[0].labelHash).toBe(
    "0x6707d6843139c46c28b1bb912334ca1b748756e534771639e627f401ca658c0e"
  );

  await ponder.kill();
});

test("filters on string field in", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(where: { labelHash_in: ["0x6707d6843139c46c28b1bb912334ca1b748756e534771639e627f401ca658c0e", "0xd5a4346caa6c1cdd83dc38218d695e6b7f0f038d11b675535cfed0245927da74"] }) {
      id
      labelHash
    }
  `);

  expect(ensNfts).toHaveLength(2);
  expect(ensNfts[0].labelHash).toBe(
    "0x6707d6843139c46c28b1bb912334ca1b748756e534771639e627f401ca658c0e"
  );
  expect(ensNfts[1].labelHash).toBe(
    "0xd5a4346caa6c1cdd83dc38218d695e6b7f0f038d11b675535cfed0245927da74"
  );

  await ponder.kill();
});

test("filters on relationship field equals", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(where: { owner: "0xC654A505E3d38932cAb03CCc14418044A078F8A4" }) {
      id
      owner {
        id
      }
    }
  `);

  expect(ensNfts).toHaveLength(2);
  expect(ensNfts[0].owner.id).toBe(
    "0xC654A505E3d38932cAb03CCc14418044A078F8A4"
  );
  expect(ensNfts[1].owner.id).toBe(
    "0xC654A505E3d38932cAb03CCc14418044A078F8A4"
  );

  await ponder.kill();
});

test("filters on relationship field contains", async (context) => {
  const { ponder, gql } = await setup({ context });

  const { ensNfts } = await gql(`
    ensNfts(where: { owner_contains: "0xC654A505E" }) {
      id
      owner {
        id
      }
    }
  `);

  expect(ensNfts).toHaveLength(2);
  expect(ensNfts[0].owner.id).toBe(
    "0xC654A505E3d38932cAb03CCc14418044A078F8A4"
  );
  expect(ensNfts[1].owner.id).toBe(
    "0xC654A505E3d38932cAb03CCc14418044A078F8A4"
  );

  await ponder.kill();
});
