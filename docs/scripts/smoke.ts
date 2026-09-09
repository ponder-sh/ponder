/**
 * Loads a handful of representative pages in a real browser and fails on any
 * console error, uncaught exception, or failed request.
 *
 * This exists because `vite build` cannot catch a whole class of breakage that
 * only shows up in a browser: modules that resolve differently in dev (Vite
 * applies the `development` export condition, so packages can pull in
 * CommonJS-only debug builds), and client-side errors that surface after
 * hydration. Several such bugs shipped through a green build during the Vocs 2
 * migration.
 *
 * Usage:
 *   pnpm smoke                     # against `vite dev`
 *   pnpm smoke -- --preview        # against `vite preview` (production build)
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PAGES = [
  "/",
  "/docs/get-started",
  "/docs/api-reference/ponder/database", // mermaid diagram
  "/docs/0.10/config/networks", // archived + renamed page
  "/blog",
];

/** Console noise that is not an actual failure. */
const IGNORE = [
  // Analytics is blocked/absent outside production.
  "sa-api.ponder.sh",
];

const preview = process.argv.includes("--preview");
/**
 * Preview must run on 5173: without Vercel env vars the build bakes
 * `baseUrl` as `http://localhost:5173`, so the built HTML references assets
 * at that absolute origin. Dev uses a different port so it can run alongside
 * a dev server you already have open.
 */
const port = preview ? 5173 : 5273;
const baseUrl = `http://localhost:${port}`;

// `vocs preview` boots the generated `dist/preview.js` server; `vite preview`
// is a static file server and 404s on a partial-static build.
const server = preview
  ? spawn("./node_modules/.bin/vocs", ["preview", "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
    })
  : spawn("./node_modules/.bin/vite", ["dev", "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
server.stdout.setEncoding("utf8");

async function waitForServer(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok || response.status === 404) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not start within ${timeoutMs}ms`);
}

const failures: string[] = [];

try {
  await waitForServer(60_000);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Let the dev server's dependency optimizer settle before asserting, so its
  // reloads don't show up as page failures.
  if (!preview) {
    await page.goto(`${baseUrl}/docs/get-started`, {
      waitUntil: "load",
      timeout: 180_000,
    });
    await page.waitForTimeout(3_000);
  }

  for (const path of PAGES) {
    const problems: string[] = [];
    const record = (message: string) => {
      if (!IGNORE.some((ignore) => message.includes(ignore)))
        problems.push(message);
    };

    const onConsole = (message: { type: () => string; text: () => string }) => {
      if (message.type() === "error") record(message.text());
    };
    const onPageError = (error: Error) => record(`uncaught: ${error.message}`);
    // Only meaningful against the production preview: a dev server aborts
    // in-flight module requests whenever the optimizer discovers a new dep.
    const onRequestFailed = (request: { url: () => string }) => {
      if (preview) record(`request failed: ${request.url()}`);
    };

    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("requestfailed", onRequestFailed);

    // A cold dev server compiles each route on demand, and Vite reloads the
    // page when it discovers new dependencies — which aborts an in-flight
    // navigation. Retry those rather than reporting them as failures.
    let response = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await page.goto(`${baseUrl}${path}`, {
          waitUntil: "load",
          timeout: 180_000,
        });
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === 3 || !message.includes("ERR_ABORTED")) throw error;
        problems.length = 0;
        await page.waitForTimeout(2_000);
      }
    }
    // Give hydration time to run; these errors appear a beat after load.
    await page.waitForTimeout(3_000);

    const status = response?.status() ?? 0;
    if (status !== 200) problems.push(`HTTP ${status}`);

    // The shell must actually render, not just the SSR payload. A hydration
    // crash replaces it with Vocs' error boundary.
    const sidebarItems = await page.locator("[data-v-sidebar-item]").count();
    if (path.startsWith("/docs/") && sidebarItems === 0)
      problems.push("no sidebar rendered (hydration likely failed)");

    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("requestfailed", onRequestFailed);

    if (problems.length > 0) {
      failures.push(path);
      console.error(`FAIL ${path}`);
      for (const problem of [...new Set(problems)].slice(0, 5))
        console.error(`       ${problem.replace(/\s+/g, " ").slice(0, 240)}`);
    } else {
      console.log(`ok   ${path}  (${sidebarItems} sidebar items)`);
    }
  }

  await browser.close();
} finally {
  server.kill("SIGTERM");
}

if (failures.length > 0) {
  console.error(`\nsmoke: ${failures.length}/${PAGES.length} page(s) failed`);
  process.exit(1);
}
console.log(`\nsmoke: all ${PAGES.length} pages clean`);
