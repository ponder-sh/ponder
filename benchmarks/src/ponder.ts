import { execa } from "execa";
import { fetchWithTimeout, startClock } from "./utils";

const fetchReady = async (path: string) => {
  const readyResponse = await fetchWithTimeout(`http://0.0.0.0:42069/${path}`);

  if (readyResponse.status === 200) return true;
  return false;
};

const waitForSetupComplete = async () => {
  const endClock = startClock();
  let duration = 0;
  await new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (await fetchReady("health")) {
        duration = endClock();
        clearInterval(interval);
        resolve(undefined);
      }
    }, 100);
  });

  return duration;
};

const waitForSyncComplete = async () => {
  const endClock = startClock();
  let duration = 0;
  await new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (await fetchReady("ready")) {
        duration = endClock();
        clearInterval(interval);
        resolve(undefined);
      }
    }, 100);
  });

  return duration;
};

const ponder = async () => {
  console.log("Creating Ponder instance...");

  const subprocess = execa(
    "../packages/core/dist/esm/bin/ponder.js",
    ["start", `--root=${process.argv[2]}`, "--schema", "bench"],
    {
      stdio: "inherit",
      detached: true,
    },
  );

  const setupDuration = await waitForSetupComplete();
  const duration = await waitForSyncComplete();

  subprocess.kill();

  return { setupDuration, duration };
};

const bench = async () => {
  execa("psql", ["-c", "DROP SCHEMA bench CASCADE"]);
  const ponderCold = await ponder();
  execa("psql", ["-c", "DROP SCHEMA bench CASCADE"]);
  const ponderHot = await ponder();

  console.log({ ponderHot, ponderCold });
};

await bench();
