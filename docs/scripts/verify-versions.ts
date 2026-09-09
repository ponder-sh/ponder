/**
 * Guards the version system against drift. Run with `pnpm verify-versions`.
 *
 * Vocs' own `checkDeadlinks` covers sidebar links that point at missing pages.
 * This covers the other direction (pages missing from every sidebar) plus the
 * invariants the generated sidebars depend on.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { productionUrl } from "../base-url.ts";
import { docsTree, latestSubpaths } from "../docs-tree.ts";
import { sidebar } from "../sidebar.ts";
import {
  getBestSubpathForVersion,
  getCanonicalSubpath,
  getDelta,
  getVersion,
  versions,
} from "../versions.ts";

// Run from the docs package root (see the `verify-versions` npm script).
const docsRoot = join(process.cwd(), "pages", "docs");

/**
 * Pages that intentionally exist without a sidebar entry. Keep this list
 * short — anything here is unreachable by navigation.
 */
const allowedOrphans = new Set([
  "/docs/why-ponder",
  // Removed from the nav in every archived version, but still published.
  ...versions
    .filter((version) => !version.isLatest)
    .map((version) => `${version.prefix}/advanced/telemetry`),
]);

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walkFiles(path);
    return path.endsWith(".mdx") ? [path] : [];
  });
}

function walkLinks(items: readonly { link?: string; items?: unknown }[]) {
  return items.flatMap((item): string[] => [
    ...(item.link ? [item.link] : []),
    ...(item.items
      ? walkLinks(item.items as readonly { link?: string }[])
      : []),
  ]);
}

const errors: string[] = [];

// Every page on disk is reachable from exactly one sidebar.
const linked = new Set(
  Object.values(sidebar).flatMap((items) => walkLinks(items)),
);
const onDisk = walkFiles(docsRoot).map(
  (path) => `/docs/${relative(docsRoot, path).replace(/\.mdx$/, "")}`,
);

for (const page of onDisk)
  if (!linked.has(page) && !allowedOrphans.has(page))
    errors.push(`page is in no sidebar: ${page}`);

for (const link of linked)
  if (!onDisk.includes(link))
    errors.push(`sidebar links missing page: ${link}`);

// Every archived page resolves to a real latest page, or to nothing at all.
for (const page of onDisk) {
  const version = getVersion(page);
  if (version === undefined || version.key === "latest") continue;
  const canonical = getCanonicalSubpath(page);
  if (canonical !== null && !latestSubpaths.has(canonical))
    errors.push(`canonical target does not exist: ${page} -> ${canonical}`);
}

// Switching versions always lands on a page that exists.
for (const page of onDisk)
  for (const version of versions) {
    const target = getBestSubpathForVersion(page, version.key);
    if (!onDisk.includes(target))
      errors.push(`version switch lands nowhere: ${page} -> ${target}`);
  }

/**
 * `vocs.config.ts`'s `head` callback is serialized and re-evaluated in a bare
 * scope, so it inlines its own copy of the rename/removal exceptions. Assert
 * that copy still matches the deltas above.
 */
const configSource = readFileSync(
  join(process.cwd(), "vocs.config.ts"),
  "utf8",
);
const inlinedRenames = [
  ...configSource.matchAll(/"(\/docs\/[\w./-]+)": "(\/docs\/[\w./-]+)",/g),
].map(([, from, to]) => `${from} -> ${to}`);

const archivedKeys = versions
  .map((version) => version.key)
  .filter((key): key is Exclude<typeof key, "latest"> => key !== "latest");

const expectedRenames = archivedKeys.flatMap((key) =>
  Object.entries(getDelta(key).renamed).map(
    ([latest, { slug }]) => `${slug} -> ${latest}`,
  ),
);

for (const rename of new Set(expectedRenames))
  if (!inlinedRenames.includes(rename))
    errors.push(`head() is missing the rename exception: ${rename}`);
for (const rename of inlinedRenames)
  if (!expectedRenames.includes(rename))
    errors.push(`head() has a stale rename exception: ${rename}`);

// head() inlines the production origin; keep it in sync with base-url.ts.
if (!configSource.includes(`"${productionUrl}"`))
  errors.push(`head() should inline the production origin ${productionUrl}`);

// Pages absent from latest must be listed as removed in head().
for (const page of onDisk) {
  const version = getVersion(page);
  if (version === undefined || version.key === "latest") continue;
  if (getCanonicalSubpath(page) !== null) continue;
  const stripped = `/docs${page.slice(version.prefix.length)}`;
  if (!configSource.includes(`"${stripped}"`))
    errors.push(`head() should list ${stripped} as removed (from ${page})`);
}

// The canonical tree is the only place navigation is authored.
if (walkLinks(docsTree).some((link) => /^\/docs\/\d/.test(link)))
  errors.push("docs-tree.ts must only contain latest (unversioned) links");

if (errors.length > 0) {
  console.error(`verify-versions: ${errors.length} problem(s)`);
  for (const error of [...new Set(errors)]) console.error(`  ${error}`);
  process.exit(1);
}

console.log(
  `verify-versions: OK (${onDisk.length} pages, ${versions.length} versions, ${linked.size} sidebar links)`,
);
