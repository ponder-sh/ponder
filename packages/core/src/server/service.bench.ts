import { setupAnvil, setupContext, setupIndexingStore } from "@/_test/setup.js";
import { type TestContext, bench } from "vitest";
import { setup as serverSetup } from "./service.test.js";

let context: TestContext;
let teardownIndexing: () => Promise<void>;
let server: Awaited<ReturnType<typeof serverSetup>>;

const setup = async () => {
  context = {} as TestContext;

  setupContext(context);
  await setupAnvil(context);

  teardownIndexing = await setupIndexingStore(context);
  server = await serverSetup({
    common: context.common,
    indexingStore: context.indexingStore,
  });

  for (let i = 0; i < 100; i++) {
    await server.createTestEntity({ id: i });
  }
};

const teardown = async () => {
  await teardownIndexing();
  await server.service.kill();
};

bench(
  "Server singular requests",
  async () => {
    for (let i = 0; i < 100; i++) {
      await server.gql(`
      testEntity (id: ${i}) {
        id
        string
        int
        float
        boolean
        bytes
        bigInt
      }
    `);
    }
  },
  {
    setup,
    teardown,
    iterations: 5,
    warmupIterations: 1,
    time: 60_000,
    warmupTime: 10_000,
  },
);

bench(
  "Server plural requests",
  async () => {
    for (let i = 0; i < 100; i++) {
      await server.gql(`
      testEntitys {
        id
        string
        int
        float
        boolean
        bytes
        bigInt
      }
    `);
    }
  },
  {
    setup,
    teardown,
    iterations: 5,
    warmupIterations: 1,
    time: 60_000,
    warmupTime: 10_000,
  },
);
