import Conf from "conf";
import { randomBytes } from "crypto";
import { detect, getNpmVersion } from "detect-package-manager";
import child_process from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "os";
import PQueue from "p-queue";
import path from "path";
import pc from "picocolors";
import process from "process";

import type { Options } from "@/config/options";
import { getGitRemoteUrl } from "@/telemetry/remote";

type TelemetryEvent = {
  event: string;
  payload?: object;
};

type Context = {
  sessionId: string;
  anonymousId: string;
  projectId: string;
  meta: AnonymousMeta;
};

export type SerializableTelemetryEvent = TelemetryEvent & Context;

type TelemetryConfig = {
  enabled: boolean;
  notifiedAt: string;
  anonymousId: string;
  salt: string;
};

type AnonymousMeta = {
  // Software information
  systemPlatform: NodeJS.Platform;
  systemRelease: string;
  systemArchitecture: string;
  // Machine information
  cpuCount: number;
  cpuModel: string | null;
  cpuSpeed: number | null;
  memoryInMb: number;
  // package.json information
  ponderVersion: string;
  nodeVersion: string;
  packageManager: string;
  packageManagerVersion: string;
};

export class TelemetryService {
  private readonly conf: Conf<TelemetryConfig>;
  private readonly options: Options;
  private queue = new PQueue({ concurrency: 1 });
  private controller = new AbortController();
  private events: SerializableTelemetryEvent[] = [];
  private context?: Context;

  constructor({ options }: { options: Options }) {
    this.conf = new Conf({ projectName: "ponder" });
    this.options = options;
    this.notify();
  }

  get disabled() {
    return (
      this.options.telemetryDisabled ||
      (this.conf.has("enabled") && !this.conf.get("enabled"))
    );
  }

  get eventsCount() {
    return this.events.length;
  }

  private get anonymousId() {
    const storedId = this.conf.get("anonymousId");

    if (storedId) {
      return storedId;
    }

    const createdId = randomBytes(32).toString("hex");
    this.conf.set("anonymousId", createdId);
    return createdId;
  }

  private get salt() {
    const storedSalt = this.conf.get("salt");

    if (storedSalt) {
      return storedSalt;
    }

    const createdSalt = randomBytes(32).toString("hex");
    this.conf.set("salt", createdSalt);
    return createdSalt;
  }

  async record(event: TelemetryEvent) {
    if (this.disabled) {
      return;
    }

    const context = await this.getContext();
    const serializedEvent = { ...event, ...context };

    this.events.push(serializedEvent);
    this.queue.add(() => this.processEvent());
  }

  setEnabled(enabled: boolean) {
    this.conf.set("enabled", enabled);
  }

  async kill() {
    this.queue.pause();
    this.controller.abort();
    try {
      console.log(`[telemetry] queue size:`, this.queue.size);
      await this.queue.onIdle();
    } catch (e) {
      console.error(e);
    }
    console.log(pc.dim("[telemetry] queue flushed"));
    this.flushDetached();
  }

  oneWayHash(value: string) {
    const hash = createHash("sha256");
    // Always prepend the payload value with salt. This ensures the hash is truly
    // one-way.
    hash.update(this.salt);
    hash.update(value);
    return hash.digest("hex");
  }

  private flushDetached() {
    if (this.events.length === 0) return;

    const serializedEvents = JSON.stringify(this.events);
    const telemetryEventsFilePath = path.join(
      this.options.ponderDir,
      "telemetry-events.json"
    );
    fs.writeFileSync(telemetryEventsFilePath, serializedEvents);

    child_process.spawn(process.execPath, [
      path.join(__dirname, "detached-flush.js"),
      this.options.telemetryUrl,
      telemetryEventsFilePath,
    ]);
  }

  private async getContext() {
    if (this.context) return this.context;

    const projectId = (await getGitRemoteUrl()) ?? process.cwd();
    const cpus = os.cpus() || [];
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    let packageManager: any = "unknown";
    let packageManagerVersion: any = "unknown";
    try {
      packageManager = await detect();
      packageManagerVersion = await getNpmVersion(packageManager);
    } catch (e) {
      // Ignore
    }

    this.context = {
      anonymousId: this.anonymousId,
      sessionId: randomBytes(32).toString("hex"),
      projectId: this.oneWayHash(projectId),
      meta: {
        systemPlatform: os.platform(),
        systemRelease: os.release(),
        systemArchitecture: os.arch(),
        cpuCount: cpus.length,
        cpuModel: cpus.length ? cpus[0].model : null,
        cpuSpeed: cpus.length ? cpus[0].speed : null,
        memoryInMb: Math.trunc(os.totalmem() / Math.pow(1024, 2)),
        ponderVersion: packageJson["version"],
        nodeVersion: process.version,
        packageManager,
        packageManagerVersion,
      },
    };

    return this.context;
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
        "Attention"
      )}: Ponder now collects completely anonymous telemetry regarding usage.`
    );
    console.log(
      "This information is used to shape Ponder's roadmap and prioritize features."
    );
  }

  private async processEvent() {
    const event = this.events.pop();
    if (!event) return;

    // try {
    //   await fetch(this.options.telemetryUrl, {
    //     method: "POST",
    //     body: JSON.stringify(event),
    //     headers: { "Content-Type": "application/json" },
    //     signal: this.controller.signal,
    //   });
    // } catch (e) {
    //   const error = e as { name: string };
    //   console.log(`[telemetry] ${event.event} failed: ${error.name}, ${error}`);
    //   if (error.name === "AbortError") {
    //     console.log("pushing event back to queue");
    //     this.events.push(event);
    //   }
    // }

    console.log("finished processing event");
  }
}
