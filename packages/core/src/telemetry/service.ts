import Conf from "conf";
import { randomBytes } from "crypto";
import { createHash } from "node:crypto";
import pc from "picocolors";

import { type Options } from "@/config/options";
import { getAnonymousMeta } from "@/telemetry/anonymous-meta";
import { getGitRemoteUrl } from "@/telemetry/remote";

type TelemetryEvent = {
  eventName: string;
  payload: object;
};

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

  async record(_events: TelemetryEvent | TelemetryEvent[]) {
    const events = Array.isArray(_events) ? _events : [_events];
    return this.submitEvents(events);
  }

  setEnabled(enabled: boolean) {
    this.conf.set("enabled", enabled);
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

  private async submitEvents(events: TelemetryEvent[]) {
    if (this.disabled) {
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
