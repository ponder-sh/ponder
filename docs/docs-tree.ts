import type { Config } from "vocs/config";

type SidebarItem = Extract<
  NonNullable<Config["sidebar"]>,
  readonly unknown[]
>[number];

/**
 * The canonical documentation tree, describing the *latest* version.
 *
 * Every archived version's sidebar is generated from this tree by applying
 * that version's delta (see `versions.ts`) — omitting pages it does not have
 * and applying renames. Edit navigation here only.
 */
export const docsTree = [
  {
    text: "Introduction",
    items: [
      { text: "Get started", link: "/docs/get-started" },
      { text: "Requirements", link: "/docs/requirements" },
      { text: "Database", link: "/docs/database" },
      { text: "Migration guide", link: "/docs/migration-guide" },
    ],
  },
  {
    text: "Config",
    items: [
      { text: "Chains", link: "/docs/config/chains" },
      { text: "Contracts", link: "/docs/config/contracts" },
      { text: "Accounts", link: "/docs/config/accounts" },
      { text: "Block intervals", link: "/docs/config/block-intervals" },
    ],
  },
  {
    text: "Schema",
    items: [
      { text: "Tables", link: "/docs/schema/tables" },
      { text: "Relations", link: "/docs/schema/relations" },
      { text: "Views", link: "/docs/schema/views" },
    ],
  },
  {
    text: "Indexing",
    items: [
      { text: "Overview", link: "/docs/indexing/overview" },
      { text: "Write to the database", link: "/docs/indexing/write" },
      { text: "Read contract data", link: "/docs/indexing/read-contracts" },
    ],
  },
  {
    text: "Query",
    items: [
      {
        text: "HTTP",
        items: [
          { text: "SQL over HTTP", link: "/docs/query/sql-over-http" },
          { text: "GraphQL", link: "/docs/query/graphql" },
          { text: "API endpoints", link: "/docs/query/api-endpoints" },
        ],
      },
      { text: "Direct SQL", link: "/docs/query/direct-sql" },
    ],
  },
  {
    text: "Production",
    items: [
      { text: "Railway", link: "/docs/production/railway" },
      { text: "Self-hosting", link: "/docs/production/self-hosting" },
    ],
  },
  {
    text: "Guides",
    items: [
      { text: "Factory pattern", link: "/docs/guides/factory" },
      { text: "Isolated indexing", link: "/docs/guides/isolated-indexing" },
      { text: "Call traces", link: "/docs/guides/call-traces" },
      { text: "Transaction receipts", link: "/docs/guides/receipts" },
      { text: "Time-series data", link: "/docs/guides/time-series" },
      { text: "Offchain data", link: "/docs/guides/offchain-data" },
      { text: "Foundry", link: "/docs/guides/foundry" },
      { text: "Bun", link: "/docs/guides/bun" },
    ],
  },
  {
    text: "API reference",
    items: [
      { text: "create-ponder", link: "/docs/api-reference/create-ponder" },
      {
        text: "ponder",
        items: [
          {
            text: "CLI (dev, start, serve)",
            link: "/docs/api-reference/ponder/cli",
          },
          {
            text: "ponder.config.ts",
            link: "/docs/api-reference/ponder/config",
          },
          {
            text: "ponder.schema.ts",
            link: "/docs/api-reference/ponder/schema",
          },
          {
            text: "Indexing functions",
            link: "/docs/api-reference/ponder/indexing-functions",
          },
          {
            text: "API endpoints",
            link: "/docs/api-reference/ponder/api-endpoints",
          },
          {
            text: "Database reference",
            link: "/docs/api-reference/ponder/database",
          },
        ],
      },
      { text: "@ponder/client", link: "/docs/api-reference/ponder-client" },
      { text: "@ponder/react", link: "/docs/api-reference/ponder-react" },
      { text: "@ponder/utils", link: "/docs/api-reference/ponder-utils" },
    ],
  },
  {
    text: "Advanced",
    items: [{ text: "Observability", link: "/docs/advanced/observability" }],
  },
] as const satisfies readonly SidebarItem[];

/** Every page path in the latest docs, derived from `docsTree`. */
export const latestSubpaths: ReadonlySet<string> = new Set(
  (function walk(items: readonly SidebarItem[]): string[] {
    return items.flatMap((item) => [
      ...(item.link ? [item.link] : []),
      ...(item.items ? walk(item.items) : []),
    ]);
  })(docsTree),
);
