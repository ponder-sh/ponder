import dotenv from "dotenv";

async function globalSetup() {
  dotenv.config({ path: ".env.local" });
}

if ("bun" in process.versions) {
  require("bun:test").beforeAll(async () => {
    await globalSetup();
  });
}

export default globalSetup;
