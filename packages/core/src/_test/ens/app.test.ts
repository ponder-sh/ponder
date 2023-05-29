import { rmSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterEach, expect, test } from "vitest";

import { testNetworkConfig } from "@/_test/utils";
import { buildOptions } from "@/config/options";
import { buildPonderConfig } from "@/config/ponderConfig";
import { Ponder } from "@/Ponder";

const setup = async () => {
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
  const testOptions = { ...options, uiEnabled: false, logLevel: 0 };

  const ponder = new Ponder({ config: testConfig, options: testOptions });

  const app = request(ponder.serverService.app);

  const gql = async (query: string) => {
    const response = await app.post("/").send({ query: `query { ${query} }` });

    expect(response.body.errors).toBe(undefined);
    expect(response.statusCode).toBe(200);

    return response.body.data;
  };

  return { ponder, gql };
};

afterEach(() => {
  rmSync("./test/Ponder/ens/.ponder", { recursive: true, force: true });
  rmSync("./test/Ponder/ens/generated", { recursive: true, force: true });
});

test("serves data", async () => {
  const { ponder, gql } = await setup();

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

  expect(ensNfts).toHaveLength(58);
  expect(accounts).toHaveLength(68);

  await ponder.kill();
});

test("returns string array types", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts {
      id
      stringArray
    }
  `);

  expect(ensNfts[0].stringArray).toEqual(["123", "abc"]);

  await ponder.kill();
});

test("returns int array types", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts {
      id
      intArray
    }
  `);

  expect(ensNfts[0].intArray).toEqual([123, 456]);

  await ponder.kill();
});

test("limits", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts(first: 2) {
      id
    }
  `);

  expect(ensNfts).toHaveLength(2);

  await ponder.kill();
});

test("skips", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts(skip: 5) {
      id
    }
  `);

  expect(ensNfts).toHaveLength(53);

  await ponder.kill();
});

test("orders ascending", async () => {
  const { ponder, gql } = await setup();

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

test("orders descending", async () => {
  const { ponder, gql } = await setup();

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

test("filters on integer field equals", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts(where: { transferredAt: 1673278703 }) {
      id
      transferredAt
    }
  `);

  expect(ensNfts).toHaveLength(1);
  expect(ensNfts[0].transferredAt).toBe(1673278703);

  await ponder.kill();
});

test("filters on integer field in", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts(where: { transferredAt_in: [1673278703, 1673278739] }) {
      id
      transferredAt
    }
  `);

  expect(ensNfts).toHaveLength(2);
  const transferredAt = ensNfts.map((n: any) => n.transferredAt);
  expect(transferredAt).toContain(1673278703);
  expect(transferredAt).toContain(1673278739);

  await ponder.kill();
});

test("filters on string field equals", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts(where: { labelHash: "0x547890107c99e60da4fb9602a9e7641d3c380755f3298d0c8edc490b595af6c7" }) {
      id
      labelHash
    }
  `);

  expect(ensNfts).toHaveLength(1);
  expect(ensNfts[0].labelHash).toBe(
    "0x547890107c99e60da4fb9602a9e7641d3c380755f3298d0c8edc490b595af6c7"
  );

  await ponder.kill();
});

test("filters on string field in", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts(where: { labelHash_in: ["0x547890107c99e60da4fb9602a9e7641d3c380755f3298d0c8edc490b595af6c7", "0xa594dce9890a89d2a1399c0870196851ca7a0db19650fb38c682a6599a6b4d9b"] }) {
      id
      labelHash
    }
  `);

  expect(ensNfts).toHaveLength(2);
  expect(ensNfts[0].labelHash).toBe(
    "0x547890107c99e60da4fb9602a9e7641d3c380755f3298d0c8edc490b595af6c7"
  );
  expect(ensNfts[1].labelHash).toBe(
    "0xa594dce9890a89d2a1399c0870196851ca7a0db19650fb38c682a6599a6b4d9b"
  );

  await ponder.kill();
});

test("filters on relationship field equals", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts(where: { owner: "0x3b42845cD161fE095e083aF493525271a3CF27cf" }) {
      id
      owner {
        id
      }
    }
  `);

  expect(ensNfts).toHaveLength(2);
  expect(ensNfts[0].owner.id).toBe(
    "0x3b42845cD161fE095e083aF493525271a3CF27cf"
  );
  expect(ensNfts[1].owner.id).toBe(
    "0x3b42845cD161fE095e083aF493525271a3CF27cf"
  );

  await ponder.kill();
});

test("filters on relationship field contains", async () => {
  const { ponder, gql } = await setup();

  const { ensNfts } = await gql(`
    ensNfts(where: { owner_contains: "0x3b42845cD161f" }) {
      id
      owner {
        id
      }
    }
  `);

  expect(ensNfts).toHaveLength(2);
  expect(ensNfts[0].owner.id).toBe(
    "0x3b42845cD161fE095e083aF493525271a3CF27cf"
  );
  expect(ensNfts[1].owner.id).toBe(
    "0x3b42845cD161fE095e083aF493525271a3CF27cf"
  );

  await ponder.kill();
});
