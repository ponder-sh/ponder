import { setupContext } from "@/_test/setup.js";
import { type TestContext, bench } from "vitest";
import { setup as serverSetup } from "./service.test.js";

let context: TestContext;
let server: Awaited<ReturnType<typeof serverSetup>>;

const setup = async () => {
  context = {} as TestContext;
  setupContext(context);

  const server = await serverSetup({
    context,
  });

  for (let i = 0; i < 100; i++) {
    await server.createTestEntity({ id: i });
  }
};

const teardown = async () => {
  await server.service.kill();
  await server.cleanup();
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
  { setup, teardown },
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
  { setup, teardown },
);
