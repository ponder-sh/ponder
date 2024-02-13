import { createHash } from "node:crypto";
import fs from "node:fs";

import { randomBytes } from "crypto";
import os from "os";
import path from "path";
import Conf from "conf";
// @ts-ignore
import { detect, getNpmVersion } from "detect-package-manager";
import PQueue from "p-queue";
import pc from "picocolors";
import process from "process";

import type { Options } from "@/config/options.js";
import { getGitRemoteUrl } from "@/telemetry/remote.js";
import { wait } from "@/utils/wait.js";

type TelemetryEvent = {
  event: string;
  properties?: any;
};

type TelemetryDeviceConfig = {
  enabled: boolean;
  notifiedAt: string;
  anonymousId: string;
  salt: string;
};

type TelemetryEventContext = {
  projectId: string;
  sessionId: string;
  packageManager: string;
  packageManagerVersion: string;
  nodeVersion: string;
  ponderVersion: string;
  systemPlatform: NodeJS.Platform;
  systemRelease: string;
  systemArchitecture: string;
  cpuCount: number;
  cpuModel: string | null;
  cpuSpeed: number | null;
  memoryInMb: number;
  isExampleProject: boolean;
};

export class TelemetryService {
  private options: Options;
  private conf: Conf<TelemetryDeviceConfig>;

  private queue = new PQueue({ concurrency: 1 });
  private events: TelemetryEvent[] = [];

  private controller = new AbortController();
  private context?: TelemetryEventContext;
  private heartbeatIntervalId?: NodeJS.Timeout;

  constructor({ options }: { options: Options }) {
    this.options = options;
    this.conf = new Conf({ projectName: "ponder" });
    this.notify();
    this.heartbeatIntervalId = setInterval(() => {
      this.record({ event: "Heartbeat" });
    }, 60_000);
  }

  record(event: TelemetryEvent) {
    if (this.disabled) return;
    this.events.push(event);
    this.queue.add(() => this.processEvent());
  }

  async flush() {
    await this.queue.onIdle();
  }

  private processEvent = async () => {
    const event = this.events.pop();
    if (!event) return;

    // Build the context. If it's already been built, this will return immediately.
    try {
      await this.getContext();
    } catch (e) {
      // Do nothing
    }

    // See https://segment.com/docs/connections/spec/track
    const serializedEvent = {
      ...event,
      anonymousId: this.anonymousId,
      context: this.context,
    };

    try {
      await fetch(this.options.telemetryUrl, {
        method: "POST",
        body: JSON.stringify(serializedEvent),
        headers: { "Content-Type": "application/json" },
        signal: this.controller.signal,
      });
    } catch (e) {
      // Do nothing
    }
  };

  async kill() {
    clearInterval(this.heartbeatIntervalId);
    this.queue.pause();
    this.queue.clear();
    await Promise.race([wait(500), this.queue.onIdle()]);
    if (this.queue.pending > 0) {
      this.controller.abort();
    }
  }

  private notify() {
    if (
      this.disabled ||
      this.conf.get("notifiedAt") ||
      process.env.NODE_ENV === "test"
    ) {
      return;
    }

    this.conf.set("notifiedAt", Date.now().toString());

    console.log(
      `${pc.magenta(
        "Attention",
      )}: Ponder collects anonymous telemetry data to identify issues and prioritize features. See https://ponder.sh/advanced/telemetry for more information.`,
    );
  }

  get disabled() {
    return (
      this.options.telemetryDisabled ||
      (this.conf.has("enabled") && !this.conf.get("enabled"))
    );
  }

  private get anonymousId() {
    const storedAnonymousId = this.conf.get("anonymousId");
    if (storedAnonymousId) return storedAnonymousId;

    const createdId = randomBytes(32).toString("hex");
    this.conf.set("anonymousId", createdId);
    return createdId;
  }

  private get salt() {
    const storedSalt = this.conf.get("salt");
    if (storedSalt) return storedSalt;

    const createdSalt = randomBytes(32).toString("hex");
    this.conf.set("salt", createdSalt);
    return createdSalt;
  }

  private oneWayHash(value: string) {
    const hash = createHash("sha256");
    // Always prepend the payload value with salt. This ensures the hash is truly
    // one-way.
    hash.update(this.salt);
    hash.update(value);
    return hash.digest("hex");
  }

  private async getContext() {
    if (this.context) return this.context;

    const sessionId = randomBytes(32).toString("hex");
    const projectIdRaw = (await getGitRemoteUrl()) ?? process.cwd();
    const projectId = this.oneWayHash(projectIdRaw);

    let packageManager: any = "unknown";
    let packageManagerVersion: any = "unknown";
    try {
      packageManager = await detect();
      packageManagerVersion = await getNpmVersion(packageManager);
    } catch (e) {
      // Ignore
    }

    const packageJsonCwdPath = path.join(process.cwd(), "package.json");
    const packageJsonRootPath = path.join(this.options.rootDir, "package.json");
    const packageJsonPath = fs.existsSync(packageJsonCwdPath)
      ? packageJsonCwdPath
      : fs.existsSync(packageJsonRootPath)
        ? packageJsonRootPath
        : undefined;
    const packageJson = packageJsonPath
      ? JSON.parse(fs.readFileSync("package.json", "utf8"))
      : undefined;
    const ponderVersion = packageJson
      ? packageJson.dependencies["@ponder/core"]
      : "unknown";

    const cpus = os.cpus() || [];

    this.context = {
      sessionId,
      projectId,
      nodeVersion: process.version,
      packageManager,
      packageManagerVersion,
      ponderVersion,
      systemPlatform: os.platform(),
      systemRelease: os.release(),
      systemArchitecture: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus.length ? cpus[0].model : null,
      cpuSpeed: cpus.length ? cpus[0].speed : null,
      memoryInMb: Math.trunc(os.totalmem() / 1024 ** 2),
      isExampleProject: this.options.telemetryIsExampleProject,
    } satisfies TelemetryEventContext;

    return this.context;
  }
}
