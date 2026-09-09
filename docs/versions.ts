import pkg from "../packages/core/package.json" with { type: "json" };
import { latestSubpaths } from "./docs-tree.ts";

/**
 * Single source of truth for the documentation version system.
 *
 * Every archived version's page tree mirrors the latest tree, so paths are
 * derived (see `toLatest` / `toVersion`) rather than enumerated. The only
 * hand-maintained data is the per-version delta below: pages that a version
 * does not have, and the handful of pages that were renamed.
 */
export const versions = [
  {
    key: "latest",
    label: "Latest Version",
    patch: pkg.version,
    prefix: "/docs",
    isLatest: true,
  },
  {
    key: "0.15",
    label: "Version 0.15",
    patch: "0.15.18",
    prefix: "/docs/0.15",
    isLatest: false,
  },
  {
    key: "0.14",
    label: "Version 0.14",
    patch: "0.14.13",
    prefix: "/docs/0.14",
    isLatest: false,
  },
  {
    key: "0.12",
    label: "Versions 0.12 - 0.13",
    patch: "0.13.13, 0.12.26",
    prefix: "/docs/0.12",
    isLatest: false,
  },
  {
    key: "0.11",
    label: "Version 0.11",
    patch: "0.11.43",
    prefix: "/docs/0.11",
    isLatest: false,
  },
  {
    key: "0.10",
    label: "Version 0.10",
    patch: "0.10.26",
    prefix: "/docs/0.10",
    isLatest: false,
  },
] as const;

export type VersionKey = (typeof versions)[number]["key"];
export type Version = (typeof versions)[number];

/**
 * Per-version deltas against the latest docs tree, keyed by the *canonical*
 * (latest) subpath.
 *
 * - `absent`: the page does not exist in this version.
 * - `renamed`: the page exists under a different slug and/or sidebar label.
 *
 * Verified against the previous hand-written sidebars and canonical path maps
 * (see `scripts/verify-versions.ts`).
 */
type Delta = {
  /** Canonical (latest) subpaths this version does not have. */
  absent: readonly string[];
  /** Canonical subpath -> the slug and sidebar label this version uses. */
  renamed: Readonly<Record<string, { slug: string; text: string }>>;
  /**
   * Sidebar group label -> the order its pages appear in, as canonical
   * subpaths. Only needed where a version's ordering differs from latest;
   * pages not listed keep their relative order and sort last.
   */
  order: Readonly<Record<string, readonly string[]>>;
};

const deltas: Record<Exclude<VersionKey, "latest">, Delta> = {
  "0.15": {
    absent: ["/docs/why-ponder", "/docs/guides/bun"],
    renamed: {},
    order: {},
  },
  "0.14": {
    absent: [
      "/docs/why-ponder",
      "/docs/guides/bun",
      "/docs/guides/isolated-indexing",
    ],
    renamed: {},
    order: {},
  },
  "0.12": {
    absent: [
      "/docs/why-ponder",
      "/docs/schema/views",
      "/docs/guides/isolated-indexing",
      "/docs/guides/bun",
    ],
    renamed: {},
    order: {
      // 0.11 and 0.12 listed "Offchain data" first.
      Guides: [
        "/docs/guides/offchain-data",
        "/docs/guides/factory",
        "/docs/guides/call-traces",
        "/docs/guides/receipts",
        "/docs/guides/time-series",
        "/docs/guides/foundry",
      ],
    },
  },
  "0.11": {
    absent: [
      "/docs/why-ponder",
      "/docs/schema/views",
      "/docs/guides/isolated-indexing",
      "/docs/guides/bun",
    ],
    renamed: {},
    order: {
      // 0.11 and 0.12 listed "Offchain data" first.
      Guides: [
        "/docs/guides/offchain-data",
        "/docs/guides/factory",
        "/docs/guides/call-traces",
        "/docs/guides/receipts",
        "/docs/guides/time-series",
        "/docs/guides/foundry",
      ],
    },
  },
  "0.10": {
    absent: [
      "/docs/why-ponder",
      "/docs/schema/views",
      "/docs/guides/isolated-indexing",
      "/docs/guides/offchain-data",
      "/docs/guides/bun",
    ],
    renamed: {
      "/docs/config/chains": {
        slug: "/docs/config/networks",
        text: "Networks",
      },
      "/docs/query/sql-over-http": {
        slug: "/docs/query/sql-client",
        text: "SQL client",
      },
    },
    order: {
      // 0.10 listed GraphQL before the SQL client page.
      HTTP: [
        "/docs/query/graphql",
        "/docs/query/sql-over-http",
        "/docs/query/api-endpoints",
      ],
    },
  },
};

export function getDelta(key: Exclude<VersionKey, "latest">) {
  return deltas[key];
}

const byLongestPrefix = [...versions].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

/** The version that owns `subpath`, or `undefined` if it is not a docs page. */
export function getVersion(subpath: string): Version | undefined {
  return byLongestPrefix.find(
    (v) => subpath === v.prefix || subpath.startsWith(`${v.prefix}/`),
  );
}

/**
 * Map any docs subpath to the equivalent page in the latest docs, or `null`
 * when the page has no latest equivalent (it was removed).
 *
 * Used for `<link rel="canonical">` and for the "view the latest version of
 * this page" link in the outdated-version callout.
 */
export function getCanonicalSubpath(subpath: string): string | null {
  const version = getVersion(subpath);
  if (version === undefined) return null;
  if (version.key === "latest") return null;

  const delta = deltas[version.key];
  const canonical = `/docs${subpath.slice(version.prefix.length)}`;

  // Reverse the rename, if this page was renamed in this version.
  for (const [latestSlug, renamed] of Object.entries(delta.renamed))
    if (renamed.slug === canonical) return latestSlug;

  // Pages absent from latest (e.g. removed) have no canonical equivalent.
  if (!latestSubpaths.has(canonical)) return null;

  return canonical;
}

/**
 * Map `subpath` to the best equivalent page in `toKey`, falling back to that
 * version's landing page when the current page has no equivalent there.
 */
export function getBestSubpathForVersion(
  subpath: string,
  toKey: VersionKey,
): string {
  const to = versions.find((v) => v.key === toKey);
  if (to === undefined) return "/docs/get-started";

  const from = getVersion(subpath);
  const home = `${to.prefix}/get-started`;
  if (from === undefined) return home;

  // Normalize to a canonical (latest) subpath first.
  const canonical =
    from.key === "latest" ? subpath : getCanonicalSubpath(subpath);
  if (canonical === null) return home;

  if (to.key === "latest")
    return latestSubpaths.has(canonical) ? canonical : home;

  const delta = deltas[to.key];
  if (delta.absent.includes(canonical)) return home;

  const renamed = delta.renamed[canonical];
  const slug = renamed ? renamed.slug : canonical;
  return `${to.prefix}${slug.slice("/docs".length)}`;
}
