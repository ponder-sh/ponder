import type { Config } from "vocs/config";

/**
 * Permanent redirects for legacy documentation URLs.
 *
 * Previously served from vercel.json (one `redirects` entry plus 58
 * `rewrites`). The rewrites served new content at the *old* URL without
 * changing the address bar; as redirects they now change the URL too, which
 * lets search engines consolidate ranking signals onto the canonical path.
 *
 * Destinations vary per source within every URL group (e.g. under
 * `/docs/api-reference/`, `config` maps to `ponder/config` but `ponder-cli`
 * maps to `ponder/cli`), so no group can be collapsed into a `:path*`
 * wildcard without changing behavior. They stay enumerated on purpose.
 */
export const redirects: Config["redirects"] = [
  // Docs root. `/docs/` came from the vercel.json `redirects` array. `/docs`
  // is included alongside it because Vocs normalizes trailing slashes before
  // matching redirects, and there is no `pages/docs/index` page to serve.
  { source: "/docs/", destination: "/docs/get-started", status: 308 },
  { source: "/docs", destination: "/docs/get-started", status: 308 },

  // Pre-0.7 docs, versioned under `/0_6`.
  {
    source: "/0_6/docs/utilities/types",
    destination: "/docs/api-reference/ponder/config#types",
    status: 308,
  },
  {
    source: "/0_6/docs/advanced/foundry",
    destination: "/docs/0.10/guides/foundry",
    status: 308,
  },
  {
    source: "/0_6/docs/advanced/logging",
    destination: "/docs/0.10/advanced/observability",
    status: 308,
  },
  {
    source: "/0_6/docs/advanced/metrics",
    destination: "/docs/0.10/advanced/observability",
    status: 308,
  },
  {
    source: "/0_6/docs/advanced/status",
    destination: "/docs/0.10/advanced/observability",
    status: 308,
  },
  {
    source: "/0_6/docs/api-reference/config",
    destination: "/docs/0.10/api-reference/ponder/config",
    status: 308,
  },
  {
    source: "/0_6/docs/api-reference/create-ponder",
    destination: "/docs/0.10/api-reference/create-ponder",
    status: 308,
  },
  {
    source: "/0_6/docs/api-reference/indexing-functions",
    destination: "/docs/0.10/api-reference/ponder/indexing-functions",
    status: 308,
  },
  {
    source: "/0_6/docs/api-reference/ponder-cli",
    destination: "/docs/0.10/api-reference/ponder/cli",
    status: 308,
  },
  {
    source: "/0_6/docs/api-reference/schema",
    destination: "/docs/0.10/api-reference/ponder/schema",
    status: 308,
  },
  {
    source: "/0_6/docs/block-intervals",
    destination: "/docs/0.10/config/block-intervals",
    status: 308,
  },
  {
    source: "/0_6/docs/contracts-and-networks",
    destination: "/docs/0.10/config/contracts",
    status: 308,
  },
  {
    source: "/0_6/docs/getting-started/installation",
    destination: "/docs/0.10/get-started",
    status: 308,
  },
  {
    source: "/0_6/docs/getting-started/migrate-subgraph",
    destination: "/docs/0.10/migration-guide",
    status: 308,
  },
  {
    source: "/0_6/docs/getting-started/new-project",
    destination: "/docs/0.10/get-started",
    status: 308,
  },
  {
    source: "/0_6/docs/indexing/call-traces",
    destination: "/docs/0.10/guides/call-traces",
    status: 308,
  },
  {
    source: "/0_6/docs/indexing/create-update-records",
    destination: "/docs/0.10/indexing/write",
    status: 308,
  },
  {
    source: "/0_6/docs/indexing/read-contract-data",
    destination: "/docs/0.10/indexing/read-contracts",
    status: 308,
  },
  {
    source: "/0_6/docs/indexing/time-series",
    destination: "/docs/0.10/guides/time-series",
    status: 308,
  },
  {
    source: "/0_6/docs/migration-guide",
    destination: "/docs/0.10/migration-guide",
    status: 308,
  },
  {
    source: "/0_6/docs/production/deploy",
    destination: "/docs/0.10/production/self-hosting",
    status: 308,
  },
  {
    source: "/0_6/docs/production/horizontal-scaling",
    destination: "/docs/0.10/production/self-hosting",
    status: 308,
  },
  {
    source: "/0_6/docs/query/api-functions",
    destination: "/docs/0.10/query/api-endpoints",
    status: 308,
  },
  {
    source: "/0_6/docs/query/direct-sql",
    destination: "/docs/0.10/query/direct-sql",
    status: 308,
  },
  {
    source: "/0_6/docs/query/graphql",
    destination: "/docs/0.10/query/graphql",
    status: 308,
  },
  {
    source: "/0_6/docs/schema",
    destination: "/docs/0.10/api-reference/ponder/schema",
    status: 308,
  },
  {
    source: "/0_6/docs/utilities/merge-abis",
    destination: "/docs/api-reference/ponder-utils",
    status: 308,
  },
  {
    source: "/0_6/docs/utilities/replace-bigints",
    destination: "/docs/api-reference/ponder-utils",
    status: 308,
  },
  {
    source: "/0_6/docs/utilities/transports",
    destination: "/docs/api-reference/ponder-utils#transports",
    status: 308,
  },
  {
    source: "/0_6/docs/why-ponder",
    destination: "/docs/why-ponder",
    status: 308,
  },

  // Unversioned docs paths that moved during the 0.7 -> 0.10 reorganization.
  {
    source: "/docs/accounts",
    destination: "/docs/config/accounts",
    status: 308,
  },
  {
    source: "/docs/advanced/foundry",
    destination: "/docs/guides/foundry",
    status: 308,
  },
  {
    source: "/docs/advanced/logging",
    destination: "/docs/advanced/observability",
    status: 308,
  },
  {
    source: "/docs/advanced/metrics",
    destination: "/docs/advanced/observability",
    status: 308,
  },
  {
    source: "/docs/advanced/status",
    destination: "/docs/advanced/observability",
    status: 308,
  },
  {
    source: "/docs/api-reference/config",
    destination: "/docs/api-reference/ponder/config",
    status: 308,
  },
  {
    source: "/docs/api-reference/database",
    destination: "/docs/api-reference/ponder/database",
    status: 308,
  },
  {
    source: "/docs/api-reference/indexing-functions",
    destination: "/docs/api-reference/ponder/indexing-functions",
    status: 308,
  },
  {
    source: "/docs/api-reference/ponder-cli",
    destination: "/docs/api-reference/ponder/cli",
    status: 308,
  },
  {
    source: "/docs/api-reference/schema",
    destination: "/docs/api-reference/ponder/schema",
    status: 308,
  },
  {
    source: "/docs/block-intervals",
    destination: "/docs/config/block-intervals",
    status: 308,
  },
  {
    source: "/docs/call-traces",
    destination: "/docs/guides/call-traces",
    status: 308,
  },
  {
    source: "/docs/contracts-and-networks",
    destination: "/docs/config/contracts",
    status: 308,
  },
  {
    source: "/docs/getting-started/database",
    destination: "/docs/database",
    status: 308,
  },
  {
    source: "/docs/getting-started/migrate-subgraph",
    destination: "/docs/migration-guide",
    status: 308,
  },
  {
    source: "/docs/getting-started/new-project",
    destination: "/docs/get-started",
    status: 308,
  },
  {
    source: "/docs/getting-started/system-requirements",
    destination: "/docs/requirements",
    status: 308,
  },
  {
    source: "/docs/indexing/read-contract-data",
    destination: "/docs/indexing/read-contracts",
    status: 308,
  },
  {
    source: "/docs/indexing/write-to-the-database",
    destination: "/docs/indexing/write",
    status: 308,
  },
  {
    source: "/docs/production/deploy",
    destination: "/docs/production/self-hosting",
    status: 308,
  },
  {
    source: "/docs/query/api-functions",
    destination: "/docs/query/api-endpoints",
    status: 308,
  },
  {
    source: "/docs/query/client",
    destination: "/docs/query/sql-over-http",
    status: 308,
  },
  {
    source: "/docs/query/sql-client",
    destination: "/docs/query/sql-over-http",
    status: 308,
  },
  {
    source: "/docs/schema",
    destination: "/docs/api-reference/ponder/schema",
    status: 308,
  },
  {
    source: "/docs/utilities/merge-abis",
    destination: "/docs/api-reference/ponder-utils",
    status: 308,
  },
  {
    source: "/docs/utilities/replace-bigints",
    destination: "/docs/api-reference/ponder-utils",
    status: 308,
  },
  {
    source: "/docs/utilities/transports",
    destination: "/docs/api-reference/ponder-utils#transports",
    status: 308,
  },
  {
    source: "/docs/utilities/types",
    destination: "/docs/api-reference/ponder/config#types",
    status: 308,
  },
];
