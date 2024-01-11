import fs from "node:fs";

async function detachedFlush() {
  const args = [...process.argv];
  const [_execPath, _scriptPath, telemetryUrl, eventsFilePath] = args;

  let eventsContent;
  try {
    eventsContent = fs.readFileSync(eventsFilePath, "utf8");
    fs.rmSync(eventsFilePath);
  } catch (e) {
    return;
  }
  const events = JSON.parse(eventsContent);
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
      }),
    );
  } catch (e) {
    fs.rmSync(_scriptPath);
    console.error(e);
  }
}

detachedFlush()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
