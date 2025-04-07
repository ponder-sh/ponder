import type { Sidebar } from "vocs";

export const sidebar = {
  "/docs/": [
    {
      text: "Introduction",
      items: [
        { text: "Getting started", link: "/docs/getting-started" },
        { text: "Installation", link: "/docs/installation" },
        { text: "Migration guide", link: "/docs/migration-guide" },
      ],
    },
    {
      text: "Config",
      items: [
        { text: "Networks", link: "/docs/config/networks" },
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
        { text: "Overview", link: "/docs/query/overview" },
        { text: "SQL client", link: "/docs/query/sql-client" },
        { text: "GraphQL", link: "/docs/query/graphql" },
        { text: "Direct SQL", link: "/docs/query/direct-sql" },
      ],
    },
    {
      text: "HTTP API",
      items: [
        { text: "API functions", link: "/docs/http/api-functions" },
        // { text: "`/metrics`, `/ready`", link: "/docs/http/builtin" },
      ],
    },
    {
      text: "Guides",
      items: [
        { text: "Factory pattern", link: "/docs/guides/factory" },
        { text: "Call traces", link: "/docs/guides/traces" },
        { text: "Transaction receipts", link: "/docs/guides/receipts" },
        { text: "Time series data", link: "/docs/guides/time-series-data" },
        { text: "Foundry", link: "/docs/guides/foundry" },
      ],
    },
    {
      text: "Production",
      items: [
        { text: "Introduction", link: "/docs/production" },
        {
          text: "Deploy",
          items: [
            { text: "Railway", link: "/docs/production/deploy/railway" },
            {
              text: "Self-hosting",
              link: "/docs/production/deploy/self-hosting",
            },
          ],
        },
      ],
    },
    {
      text: "API reference",
      items: [
        {
          text: "ponder",
          items: [
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
              text: "API functions",
              link: "/docs/api-reference/ponder/api-functions",
            },
            {
              text: "CLI (dev, start, serve)",
              link: "/docs/api-reference/ponder/cli",
            },
          ],
        },
        { text: "@ponder/client", link: "/docs/api-reference/ponder-client" },
        { text: "@ponder/react", link: "/docs/api-reference/ponder-react" },
        { text: "@ponder/utils", link: "/docs/api-reference/ponder-utils" },
        { text: "create-ponder", link: "/docs/api-reference/create-ponder" },
      ],
    },
    {
      text: "Advanced",
      items: [
        { text: "Logs", link: "/docs/advanced/logs" },
        { text: "Metrics", link: "/docs/advanced/metrics" },
      ],
    },
  ],
} satisfies Sidebar;
