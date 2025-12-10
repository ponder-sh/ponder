import dotenv from "dotenv";
const globalSetup = async () => {
  dotenv.config({ path: ".env.local" });
};
if ("bun" in process.versions) {
  require("bun:test").beforeAll(async () => {
    await globalSetup();
  });
}

export default globalSetup;
