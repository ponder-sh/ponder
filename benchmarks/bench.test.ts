import execa from "execa";
import { beforeAll, test } from "vitest";

beforeAll(async () => {
  console.log("In beforeAll");

  // Need to exec the `graph build` and `graph deploy` commands here
  // This setup should not be part of the benchmark.
  await execa("graph", [
    "build",
    "./subgraph/subgraph.yaml",
    "--output-dir=./subgraph/build",
  ]);
}, 5_000);

test("test", async () => {
  console.log("In bench.ts!");
});
