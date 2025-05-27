import { exec } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Options } from "@/internal/options.js";
import { createQueue } from "@/utils/queue.js";
import { startClock } from "@/utils/timer.js";
import Conf from "conf";
import { type PM, detect, getNpmVersion } from "detect-package-manager";
import { ShutdownError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { Shutdown } from "./shutdown.js";
import type { IndexingBuild } from "./types.js";
import type { PreBuild, SchemaBuild } from "./types.js";

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
  shutdown,
}: { options: Options; logger: Logger; shutdown: Shutdown }) {
  if (options.telemetryDisabled) {
    return {
      record: (_event: TelemetryEvent) => {},
      flush: async () => {},
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
    const ponderVersion = packageJson?.dependencies?.ponder ?? "unknown";
    const viemVersion = packageJson?.dependencies?.viem ?? "unknown";

    // Make a guess as to whether the project is internal (within the monorepo) or not.
    const isInternal = ponderVersion === "workspace:*";

    const cpus = os.cpus();

    return {
      common: {
        session_id: sessionId,
        project_id: projectId,
        is_internal: isInternal,
      } satisfies CommonProperties,
      session: {
        ponder_core_version: ponderVersion,
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

  const queue = createQueue({
    initialStart: true,
    concurrency: 10,
    worker: async (event: TelemetryEvent) => {
      if (shutdown.isKilled) return;

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
        });
        logger.trace({
          service: "telemetry",
          msg: `Sent '${event.name}' event in ${endClock()}ms`,
        });
      } catch (error_) {
        const error = error_ as Error;

        if (shutdown.isKilled) {
          throw new ShutdownError();
        }

        logger.trace({
          service: "telemetry",
          msg: `Failed to send '${event.name}' event after ${endClock()}ms`,
          error,
        });
      }
    },
  });

  const record = (event: TelemetryEvent) => {
    queue.add(event);
  };

  const heartbeatInterval = setInterval(() => {
    record({
      name: "lifecycle:heartbeat_send",
      properties: { duration_seconds: process.uptime() },
    });
  }, HEARTBEAT_INTERVAL_MS);

  shutdown.add(() => {
    clearInterval(heartbeatInterval);
  });

  // Note that this method is only used for testing.
  const flush = async () => {
    await queue.onIdle();
  };

  return { record, flush };
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

export function buildPayload({
  preBuild,
  schemaBuild,
  indexingBuild,
}: {
  preBuild: PreBuild;
  schemaBuild?: SchemaBuild;
  indexingBuild?: IndexingBuild;
}) {
  const table_count = schemaBuild ? Object.keys(schemaBuild.schema).length : 0;
  const indexing_function_count = indexingBuild
    ? Object.values(indexingBuild.indexingFunctions).reduce(
        (acc, f) => acc + Object.keys(f).length,
        0,
      )
    : 0;

  return {
    database_kind: preBuild?.databaseConfig.kind,
    contract_count: indexingBuild?.sources.length ?? 0,
    network_count: indexingBuild?.chains.length ?? 0,
    table_count,
    indexing_function_count,
  };
}
