import execa from "execa";
import { beforeAll, test } from "vitest";

async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: RequestInit & { timeout?: number } = {}
) {
  const { timeout = 2_000 } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(input, {
    ...options,
    signal: controller.signal,
  });
  clearTimeout(id);

  return response;
}

beforeAll(async () => {
  // Need to exec the `graph build` and `graph deploy` commands here
  // This setup should not be part of the benchmark.
  // console.log("Building subgraph...");
  // await execa(
  //   "graph",
  //   ["build", "./subgraph/subgraph.yaml", "--output-dir=./subgraph/build"],
  //   {
  //     timeout: 10_000,
  //     stdio: "inherit",
  //   }
  // );

  try {
    const response5001 = await fetchWithTimeout("http://localhost:5001");
    console.log({ response5001 });
  } catch (error5001) {
    console.log({ error5001 });
  }

  console.log("Deploying subgraph...");
  await execa(
    "graph",
    [
      "deploy",
      "ponder-benchmarks/subgraph",
      "./subgraph/subgraph.yaml",
      "--output-dir=./subgraph/build",
      "--ipfs=http://localhost:5001",
      "--node=http://localhost:8020",
      "--version-label=v0.0.1",
    ],
    {
      timeout: 10_000,
      stdio: "inherit",
    }
  );

  try {
    const response8000 = await fetchWithTimeout("http://localhost:8000");
    console.log({ response8000 });
  } catch (error8000) {
    console.log({ error8000 });
  }

  try {
    const response8020 = await fetchWithTimeout("http://localhost:8020");
    console.log({ response8020 });
  } catch (error8020) {
    console.log({ error8020 });
  }

  try {
    const response8030 = await fetchWithTimeout("http://localhost:8030");
    console.log({ response8030 });
  } catch (error8030) {
    console.log({ error8030 });
  }

  try {
    const response8040 = await fetchWithTimeout("http://localhost:8040");
    console.log({ response8040 });
  } catch (error8040) {
    console.log({ error8040 });
  }
}, 60_000);

test("test", async () => {
  console.log("In test!");
});
