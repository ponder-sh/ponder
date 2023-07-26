import { randomBytes } from "crypto";
import { createHash } from "node:crypto";

import { getAnonymousMeta } from "@/telemetry/anonymous-meta";
import { getRawProjectId } from "@/telemetry/project-id";
import { TelemetryEvent } from "@/types/telemetry-event";

export class TelemetryService {
  private readonly sessionId: string;
  private readonly TELEMETRY_DISABLED: boolean;
  private distDir: string;
  private loadProjectId: string | null = null;

  constructor({ distDir }: { distDir: string }) {
    this.distDir = distDir;
    this.TELEMETRY_DISABLED = Boolean(process.env.TELEMETRY_DISABLED);
    this.sessionId = randomBytes(32).toString("hex");
  }

  get anonymousId(): string {
    return randomBytes(32).toString("hex");
  }

  get salt(): string {
    return randomBytes(16).toString("hex");
  }

  async recordEvent(_events: TelemetryEvent | TelemetryEvent[]) {
    const events = Array.isArray(_events) ? _events : [_events];
    return this.submitEvents(events);
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
    this.loadProjectId = this.loadProjectId ?? (await getRawProjectId());
    return this.oneWayHash(this.loadProjectId);
  }

  private get isDisabled() {
    return this.TELEMETRY_DISABLED;
  }

  private async submitEvents(events: TelemetryEvent[]) {
    if (this.isDisabled) {
      return;
    }

    const context = {
      sessionId: this.sessionId,
      projectId: await this.getProjectId(),
      anonymousId: this.anonymousId,
    };

    const meta = getAnonymousMeta();
    const payload = {
      events,
      context,
      meta,
    };

    console.log({ payload });

    // TODO: uncomment this when we're ready to send telemetry
    // return postPayload({
    //   endpoint: "https://telemetry.ponder.sh/api/record",
    //   payload,
    //   signal: controller.signal,
    // });
  }
}
