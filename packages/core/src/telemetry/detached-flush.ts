import { postEvent } from "@/telemetry/post-event";
import { SerializableTelemetryEvent } from "@/telemetry/service";

async function detachedFlush() {
  const args = [...process.argv];
  const [eventsFile] = args.splice(2);
  const events: SerializableTelemetryEvent[] = JSON.parse(eventsFile);
  await Promise.all(events.map((event) => postEvent(event)));
}

detachedFlush()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
