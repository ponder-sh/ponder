const fs = require("fs");

// eslint-disable-next-line no-undef
const fetch = globalThis.fetch ?? require("node-fetch");

async function detachedFlush() {
  const args = [...process.argv];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_execPath, _scriptPath, telemetryUrl, eventsFilePath] = args;

  const eventsContent = fs.readFileSync(eventsFilePath, "utf8");
  const events = JSON.parse(eventsContent);

  console.log(
    `Sending ${events.length} telemetry events to ${telemetryUrl} from temporary file ${eventsFilePath}`
  );

  try {
    await Promise.all(
      events.map(async (event) => {
        await fetch(telemetryUrl, {
          method: "POST",
          body: JSON.stringify(event),
          headers: {
            "Content-Type": "application/json",
          },
        });
      })
    );
  } catch (e) {
    console.error(e);
  }

  fs.rmSync(eventsFilePath);
}

detachedFlush()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
