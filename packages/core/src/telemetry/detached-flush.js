const fs = require("fs");
const fetch = require("node-fetch");

function postEvent({ payload }) {
  return fetch("https://ponder.sh/api/telemetry", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function detachedFlush() {
  const args = [...process.argv];
  const [eventsFile] = args.splice(2);
  const eventsContent = fs.readFileSync(eventsFile, "utf8");
  const events = JSON.parse(eventsContent);
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
