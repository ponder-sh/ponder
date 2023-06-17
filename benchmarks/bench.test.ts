import execa from "execa";
import { beforeAll, test } from "vitest";

beforeAll(async () => {
  // Need to exec the `graph build` and `graph deploy` commands here
  // This setup should not be part of the benchmark.
  console.log("Building subgraph...");
  await execa(
    "graph",
    ["build", "./subgraph/subgraph.yaml", "--output-dir=./subgraph/build"],
    {
      timeout: 10_000,
      stdio: "inherit",
    }
  );

  try {
    const response8000 = await fetch("http://localhost:8000");
    console.log({ response8000 });
  } catch (error) {
    console.log({ error });
  }

  try {
    const response8020 = await fetch("http://localhost:8020");
    console.log({ response8020 });
  } catch (error) {
    console.log({ error });
  }

  try {
    const response8030 = await fetch("http://localhost:8030");
    console.log({ response8030 });
  } catch (error) {
    console.log({ error });
  }

  try {
    const response8040 = await fetch("http://localhost:8040");
    console.log({ response8040 });
  } catch (error) {
    console.log({ error });
  }

  console.log("Deploying subgraph...");
  await execa(
    "graph",
    [
      "deploy",
      "ponder-benchmarks/subgraph",
      "./subgraph/subgraph.yaml",
      "--node=http://localhost:8020",
    ],
    {
      timeout: 10_000,
      stdio: "inherit",
    }
  );
}, 60_000);

test("test", async () => {
  console.log("In test!");
});
