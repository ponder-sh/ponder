import Conf from "conf";
import { randomBytes } from "crypto";
import { createHash } from "node:crypto";
import PQueue from "p-queue";
import pc from "picocolors";

import { type Options } from "@/config/options";
import { AnonymousMeta, getAnonymousMeta } from "@/telemetry/anonymous-meta";
import { postPayload } from "@/telemetry/post-payload";
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

export class TelemetryService {
  private readonly conf: Conf<TelemetryConfig>;
  private readonly sessionId: string;
  private readonly TELEMETRY_DISABLED: boolean;
  private rawProjectId: string | null = null;
  private queue = new PQueue({ concurrency: 1 });
  private controller = new AbortController();
  private events: SerializableTelemetryEvent[] = [];
  private context?: Context;

  constructor({ options }: { options: Options }) {
    this.conf = new Conf({ projectName: "ponder", cwd: options.ponderDir });
    this.TELEMETRY_DISABLED = Boolean(process.env.TELEMETRY_DISABLED);
    this.sessionId = randomBytes(32).toString("hex");
    this.notify();
  }

  get anonymousId(): string {
    const storedId = this.conf.get("anonymousId");

    if (storedId) {
      return storedId;
    }

    const createdId = randomBytes(32).toString("hex");
    this.conf.set("anonymousId", createdId);
    return createdId;
  }

  get salt(): string {
    const storedSalt = this.conf.get("salt");

    if (storedSalt) {
      return storedSalt;
    }

    const createdSalt = randomBytes(32).toString("hex");
    this.conf.set("salt", createdSalt);
    return createdSalt;
  }

  get disabled() {
    return this.TELEMETRY_DISABLED || !this.conf.get("enabled");
  }

  async getContext() {
    if (this.context) {
      return this.context;
    }

    this.context = {
      sessionId: this.sessionId,
      projectId: await this.getProjectId(),
      anonymousId: this.anonymousId,
      meta: getAnonymousMeta(),
    };

    return this.context;
  }

  async record(event: TelemetryEvent) {
    if (this.disabled) {
      return;
    }

    const context = await this.getContext();
    const serializedEvent = { ...event, ...context };

    this.events.push(serializedEvent);
    await this.queue.add(async () => this.processEvent());
  }

  setEnabled(enabled: boolean) {
    this.conf.set("enabled", enabled);
  }

  async kill() {
    this.queue.pause();
    await this.controller.abort();
    await this.queue.onIdle();
  }

  oneWayHash(value: string) {
    const hash = createHash("sha256");
    // Always prepend the payload value with salt. This ensures the hash is truly
    // one-way.
    hash.update(this.salt);
    hash.update(value);
    return hash.digest("hex");
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
      await postPayload({
        endpoint: "https://telemetry.ponder.sh/api/record",
        payload: event,
        signal: this.controller.signal,
      });
    } catch (e) {
      const error = e as { name: string };
      if (error.name === "AbortError") {
        this.events.push(event);
      }
    }
  }
}
