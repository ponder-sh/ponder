import Conf from "conf";
import { randomBytes } from "crypto";
import * as fs from "fs";
import { createHash } from "node:crypto";
import os from "os";
import PQueue from "p-queue";
import pc from "picocolors";

import { type Options } from "@/config/options";
import { postEvent } from "@/telemetry/post-event";
import { getGitRemoteUrl } from "@/telemetry/remote";

type TelemetryEvent = {
  eventName: string;
  payload: object;
};

type Context = {
  sessionId: string;
  anonymousId: string;
  projectId: string;
  meta: AnonymousMeta;
};

type SerializableTelemetryEvent = TelemetryEvent & Context;

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
  // TODO: detect docker
  // isDocker: boolean;
  // isNowDev: boolean;
  // isWsl: boolean;
  // isCI: boolean;
  // ciName: string | null;
  // nextVersion: string;
};

export class TelemetryService {
  private readonly conf: Conf<TelemetryConfig>;
  private readonly sessionId: string;
  private readonly TELEMETRY_DISABLED: boolean;
  private rawProjectId: string | null = null;
  private queue = new PQueue({ concurrency: 1 });
  private distDir: string;
  private controller = new AbortController();
  private events: SerializableTelemetryEvent[] = [];
  private context?: Context;
  private metadata?: AnonymousMeta;

  constructor({ options }: { options: Options }) {
    this.conf = new Conf({
      projectName: "ponder",
      cwd: options.ponderDir,
      configName: "telemetry-config",
    });
    this.distDir = options.ponderDir;
    this.TELEMETRY_DISABLED = Boolean(process.env.TELEMETRY_DISABLED);
    this.sessionId = randomBytes(32).toString("hex");
    this.notify();
  }

  get disabled() {
    return (
      this.TELEMETRY_DISABLED ||
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

  private get anonymousMeta() {
    if (this.metadata) {
      return this.metadata;
    }

    const cpus = os.cpus() || [];

    this.metadata = {
      systemPlatform: os.platform(),
      systemRelease: os.release(),
      systemArchitecture: os.arch(),
      cpuCount: cpus.length,
      cpuModel: cpus.length ? cpus[0].model : null,
      cpuSpeed: cpus.length ? cpus[0].speed : null,
      memoryInMb: Math.trunc(os.totalmem() / Math.pow(1024, 2)),
    };

    return this.metadata;
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
    return this.queue.add(() => this.processEvent());
  }

  setEnabled(enabled: boolean) {
    this.conf.set("enabled", enabled);
  }

  async kill() {
    this.queue.pause();
    await this.controller.abort();
    await this.queue.onIdle();
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
    const serializedEvents = JSON.stringify(this.events);
    const fileName = `${this.distDir}/telemetry-events.json`;
    fs.writeFileSync(fileName, serializedEvents);
  }

  private async getContext() {
    if (this.context) {
      return this.context;
    }

    this.context = {
      sessionId: this.sessionId,
      projectId: await this.getProjectId(),
      anonymousId: this.anonymousId,
      meta: this.anonymousMeta,
    };

    return this.context;
  }

  private async getProjectId() {
    if (this.rawProjectId) {
      return this.oneWayHash(this.rawProjectId);
    }
    this.rawProjectId = (await getGitRemoteUrl()) ?? process.cwd();
    return this.oneWayHash(this.rawProjectId);
  }

  private notify() {
    if (this.disabled || this.conf.get("notifiedAt")) {
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

    if (!event) {
      return;
    }

    try {
      await postEvent({ payload: event, signal: this.controller.signal });
    } catch (e) {
      const error = e as { name: string };
      if (error.name === "AbortError") {
        this.events.push(event);
      }
    }
  }
}
