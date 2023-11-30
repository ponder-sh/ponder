import { readFileSync, writeFileSync } from "node:fs";

import { execa } from "execa";

import { fetchGraphql, fetchWithTimeout, startClock } from "./utils";

const fetchSubgraphSynced = async () => {
  try {
    const response = await fetchGraphql(
      "http://localhost:8030/graphql",
      `{
        indexingStatusForCurrentVersion(subgraphName:"ponder-benchmarks/subgraph") {
          synced
        }
      }`,
    );

    const error = response.errors?.[0];

    if (error) {
      if (
        error.message?.endsWith(
          "Wait for it to ingest a few blocks before querying it",
        )
      ) {
        return 0;
      } else {
        throw error;
      }
    }

    const synced = response.data?.indexingStatusForCurrentVersion?.synced;

    return synced;
  } catch (err) {
    return 0;
  }
};

const fetchSubgraphMetrics = async () => {
  const metricsResponse = await fetchWithTimeout("http://localhost:8040");
  const metricsRaw = await metricsResponse.text();
  return metricsRaw.split("\n");
};

const waitForGraphNode = async () => {
  const endClock = startClock();
  return new Promise<number>((resolve, reject) => {
    let timeout: NodeJS.Timeout | undefined = undefined;
    const interval = setInterval(async () => {
      try {
        const metrics = await fetchSubgraphMetrics();
        if (metrics) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(endClock());
        }
      } catch (e) {
        // Ignore.
      }
    }, 1_000);

    timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for Graph Node to start"));
    }, 30_000);
  });
};

const waitForSyncComplete = async () => {
  const endClock = startClock();
  let duration: number = 0;

  await new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (await fetchSubgraphSynced()) {
        duration = endClock();
        clearInterval(interval);
        resolve(undefined);
      }
    }, 1_000);
  });

  return duration;
};

const subgraph = async () => {
  console.log(`Waiting for Graph Node to be ready...`);
  const setupDuration = await waitForGraphNode();

  console.log("Registering subgraph...");
  await execa(
    "graph",
    ["create", "ponder-benchmarks/subgraph", "--node=http://localhost:8020"],
    {
      timeout: 10_000,
      stdio: "inherit",
    },
  );

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
    },
  );

  const duration = await waitForSyncComplete();

  const metrics = (await fetchSubgraphMetrics()).filter((m) =>
    m.includes("endpoint_request"),
  );

  return { setupDuration, duration, metrics };
};

const changeMappingFileDelim = (delim: string) => {
  let mappingFileContents = readFileSync("./subgraph/src/mapping.ts", {
    encoding: "utf-8",
  });
  mappingFileContents = mappingFileContents.replace(/(dif:.)/g, `dif:${delim}`);

  writeFileSync("./subgraph/src/mapping.ts", mappingFileContents, "utf-8");
};

const bench = async () => {
  // Reset handler delimeter
  changeMappingFileDelim("-");

  const subgraphCold = await subgraph();

  // Force handler cache invalidation
  changeMappingFileDelim("+");

  const subgraphHot = await subgraph();

  console.log({ subgraphCold, subgraphHot });
};

await bench();
