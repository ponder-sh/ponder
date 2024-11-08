import { exec } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { IndexingBuild } from "@/build/service.js";
import type { Options } from "@/common/options.js";
import { startClock } from "@/utils/timer.js";
import { wait } from "@/utils/wait.js";
import { createQueue } from "@ponder/common";
import Conf from "conf";
import { type PM, detect, getNpmVersion } from "detect-package-manager";
import type { Logger } from "./logger.js";

const HEARTBEAT_INTERVAL_MS = 60_000;

type TelemetryEvent =
  | {
      name: "lifecycle:session_start";
      properties: { cli_command: string };
    }
  | {
      name: "lifecycle:session_end";
      properties: { duration_seconds: number };
    }
  | {
      name: "lifecycle:heartbeat_send";
      properties: { duration_seconds: number };
    };

type CommonProperties = {
  // Identification
  project_id: string;
  session_id: string;
  is_internal: boolean;
};

type SessionProperties = {
  // Environment and package versions
  package_manager: string;
  package_manager_version: string;
  node_version: string;
  ponder_core_version: string;
  viem_version: string;
  // System and hardware
  system_platform: NodeJS.Platform;
  system_release: string;
  system_architecture: string;
  cpu_count: number;
  cpu_model: string;
  cpu_speed: number;
  total_memory_bytes: number;
};

type DeviceConf = {
  notifiedAt?: string;
  anonymousId?: string;
  salt?: string;
};

export type Telemetry = ReturnType<typeof createTelemetry>;

export function createTelemetry({
  options,
  logger,
}: { options: Options; logger: Logger }) {
  if (options.telemetryDisabled) {
    return {
      record: (_event: TelemetryEvent) => {},
      flush: async () => {},
      kill: async () => {},
    };
  }

  const conf = new Conf<DeviceConf>({
    projectName: "ponder",
    cwd: options.telemetryConfigDir,
  });

  if (conf.get("notifiedAt") === undefined) {
    conf.set("notifiedAt", Date.now().toString());
    logger.info({
      service: "telemetry",
      msg: "Ponder collects anonymous telemetry data to identify issues and prioritize features. See https://ponder.sh/docs/advanced/telemetry for more information.",
    });
  }

  const sessionId = randomBytes(8).toString("hex");

  let anonymousId = conf.get("anonymousId") as string;
  if (anonymousId === undefined) {
    anonymousId = randomBytes(8).toString("hex");
    conf.set("anonymousId", anonymousId);
  }
  // Before 0.4.3, the anonymous ID was 64 characters long. Truncate it to 16
  // here to align with new ID lengths.
  if (anonymousId.length > 16) anonymousId = anonymousId.slice(0, 16);

  let salt = conf.get("salt") as string;
  if (salt === undefined) {
    salt = randomBytes(8).toString("hex");
    conf.set("salt", salt);
  }

  // Prepend the value with a secret salt to ensure a credible one-way hash.
  const oneWayHash = (value: string) => {
    const hash = createHash("sha256");
    hash.update(salt);
    hash.update(value);
    return hash.digest("hex").slice(0, 16);
  };

  const buildContext = async () => {
    // Project ID is a one-way hash of the git remote URL OR the current working directory.
    const gitRemoteUrl = await getGitRemoteUrl();
    const projectIdRaw = gitRemoteUrl ?? process.cwd();
    const projectId = oneWayHash(projectIdRaw);

    const { packageManager, packageManagerVersion } = await getPackageManager();

    // Attempt to find and read the users package.json file.
    const packageJson = getPackageJson(options.rootDir);
    const ponderCoreVersion =
      packageJson?.dependencies?.["@ponder/core"] ?? "unknown";
    const viemVersion = packageJson?.dependencies?.viem ?? "unknown";

    // Make a guess as to whether the project is internal (within the monorepo) or not.
    const isInternal = ponderCoreVersion === "workspace:*";

    const cpus = os.cpus();

    return {
      common: {
        session_id: sessionId,
        project_id: projectId,
        is_internal: isInternal,
      } satisfies CommonProperties,
      session: {
        ponder_core_version: ponderCoreVersion,
        viem_version: viemVersion,
        package_manager: packageManager,
        package_manager_version: packageManagerVersion,
        node_version: process.versions.node,
        system_platform: os.platform(),
        system_release: os.release(),
        system_architecture: os.arch(),
        cpu_count: cpus.length,
        cpu_model: cpus.length > 0 ? cpus[0]!.model : "unknown",
        cpu_speed: cpus.length > 0 ? cpus[0]!.speed : 0,
        total_memory_bytes: os.totalmem(),
      } satisfies SessionProperties,
    };
  };

  let context: Awaited<ReturnType<typeof buildContext>> | undefined = undefined;
  const contextPromise = buildContext();

  const controller = new AbortController();
  let isKilled = false;

  const queue = createQueue({
    initialStart: true,
    concurrency: 10,
    worker: async (event: TelemetryEvent) => {
      const endClock = startClock();
      try {
        if (context === undefined) context = await contextPromise;

        const properties =
          event.name === "lifecycle:session_start"
            ? { ...event.properties, ...context.common, ...context.session }
            : { ...event.properties, ...context.common };

        const body = JSON.stringify({
          distinctId: anonymousId,
          event: event.name,
          properties,
        });

        await fetch(options.telemetryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        });
        logger.trace({
          service: "telemetry",
          msg: `Sent '${event.name}' event in ${endClock()}ms`,
        });
      } catch (error_) {
        const error = error_ as Error;
        logger.trace({
          service: "telemetry",
          msg: `Failed to send '${event.name}' event after ${endClock()}ms`,
          error,
        });
      }
    },
  });

  const record = (event: TelemetryEvent) => {
    if (isKilled) return;
    queue.add(event);
  };

  const heartbeatInterval = setInterval(() => {
    record({
      name: "lifecycle:heartbeat_send",
      properties: { duration_seconds: process.uptime() },
    });
  }, HEARTBEAT_INTERVAL_MS);

  // Note that this method is only used for testing.
  const flush = async () => {
    await queue.onIdle();
  };

  const kill = async () => {
    clearInterval(heartbeatInterval);
    isKilled = true;
    // If there are any events in the queue that have not started, drop them.
    queue.clear();
    // Wait at most 1 second for any in-flight events to complete.
    await Promise.race([queue.onIdle(), wait(1_000)]);
  };

  return { record, flush, kill };
}

async function getPackageManager() {
  let packageManager: PM = "unknown" as PM;
  let packageManagerVersion = "unknown";
  try {
    packageManager = await detect();
    packageManagerVersion = await getNpmVersion(packageManager);
  } catch (e) {}
  return { packageManager, packageManagerVersion };
}

const execa = promisify(exec);

async function getGitRemoteUrl() {
  const result = await execa("git config --local --get remote.origin.url", {
    timeout: 250,
    windowsHide: true,
  }).catch(() => undefined);

  return result?.stdout.trim();
}

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: { [key: string]: string };
  devDependencies?: { [key: string]: string };
};

function getPackageJson(rootDir: string) {
  try {
    const rootPath = path.join(rootDir, "package.json");
    const cwdPath = path.join(process.cwd(), "package.json");

    const packageJsonPath = existsSync(rootPath)
      ? rootPath
      : existsSync(cwdPath)
        ? cwdPath
        : undefined;
    if (packageJsonPath === undefined) return undefined;

    const packageJsonString = readFileSync(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonString) as PackageJson;

    return packageJson;
  } catch (e) {
    return undefined;
  }
}

export function buildPayload(build: IndexingBuild) {
  const table_count = Object.keys(build.schema).length;
  const indexing_function_count = Object.values(build.indexingFunctions).reduce(
    (acc, f) => acc + Object.keys(f).length,
    0,
  );

  return {
    database_kind: build.databaseConfig.kind,
    contract_count: build.sources.length,
    network_count: build.networks.length,
    table_count,
    indexing_function_count,
  };
}
