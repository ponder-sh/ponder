import type { Sidebar } from "vocs";

export const sidebar = {
  "/docs/": [
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
            { text: "GraphQL", link: "/docs/query/graphql" },
            { text: "SQL client", link: "/docs/query/sql-client" },
            { text: "API endpoints", link: "/docs/query/api-endpoints" },
          ],
        },
        { text: "Direct SQL", link: "/docs/query/direct-sql" },
      ],
    },
    {
      text: "Production",
      items: [
        { text: "Marble ✨", link: "/docs/production/marble" },
        { text: "Railway", link: "/docs/production/railway" },
        { text: "Self-hosting", link: "/docs/production/self-hosting" },
      ],
    },
    {
      text: "Guides",
      items: [
        { text: "Offchain data", link: "/docs/guides/offchain" },
        { text: "Factory pattern", link: "/docs/guides/factory" },
        { text: "Call traces", link: "/docs/guides/call-traces" },
        { text: "Transaction receipts", link: "/docs/guides/receipts" },
        { text: "Time-series data", link: "/docs/guides/time-series" },
        { text: "Foundry", link: "/docs/guides/foundry" },
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
      items: [
        { text: "Observability", link: "/docs/advanced/observability" },
        { text: "Telemetry", link: "/docs/advanced/telemetry" },
      ],
    },
  ],
  "/docs/0.10/": [
    {
      text: "Introduction",
      items: [
        { text: "Get started", link: "/docs/0.10/get-started" },
        { text: "Requirements", link: "/docs/0.10/requirements" },
        { text: "Database", link: "/docs/0.10/database" },
        { text: "Migration guide", link: "/docs/0.10/migration-guide" },
      ],
    },
    {
      text: "Config",
      items: [
        { text: "Networks", link: "/docs/0.10/config/networks" },
        { text: "Contracts", link: "/docs/0.10/config/contracts" },
        { text: "Accounts", link: "/docs/0.10/config/accounts" },
        { text: "Block intervals", link: "/docs/0.10/config/block-intervals" },
      ],
    },
    {
      text: "Schema",
      items: [
        { text: "Tables", link: "/docs/0.10/schema/tables" },
        { text: "Relations", link: "/docs/0.10/schema/relations" },
      ],
    },
    {
      text: "Indexing",
      items: [
        { text: "Overview", link: "/docs/0.10/indexing/overview" },
        { text: "Write to the database", link: "/docs/0.10/indexing/write" },
        {
          text: "Read contract data",
          link: "/docs/0.10/indexing/read-contracts",
        },
      ],
    },
    {
      text: "Query",
      items: [
        {
          text: "HTTP",
          items: [
            { text: "GraphQL", link: "/docs/0.10/query/graphql" },
            { text: "SQL client", link: "/docs/0.10/query/sql-client" },
            { text: "API endpoints", link: "/docs/0.10/query/api-endpoints" },
          ],
        },
        { text: "Direct SQL", link: "/docs/0.10/query/direct-sql" },
      ],
    },
    {
      text: "Production",
      items: [
        { text: "Railway", link: "/docs/0.10/production/railway" },
        { text: "Self-hosting", link: "/docs/0.10/production/self-hosting" },
      ],
    },
    {
      text: "Guides",
      items: [
        { text: "Factory pattern", link: "/docs/0.10/guides/factory" },
        { text: "Call traces", link: "/docs/0.10/guides/call-traces" },
        { text: "Transaction receipts", link: "/docs/0.10/guides/receipts" },
        { text: "Time-series data", link: "/docs/0.10/guides/time-series" },
        { text: "Foundry", link: "/docs/0.10/guides/foundry" },
      ],
    },
    {
      text: "API reference",
      items: [
        {
          text: "create-ponder",
          link: "/docs/0.10/api-reference/create-ponder",
        },
        {
          text: "ponder",
          items: [
            {
              text: "CLI (dev, start, serve)",
              link: "/docs/0.10/api-reference/ponder/cli",
            },
            {
              text: "ponder.config.ts",
              link: "/docs/0.10/api-reference/ponder/config",
            },
            {
              text: "ponder.schema.ts",
              link: "/docs/0.10/api-reference/ponder/schema",
            },
            {
              text: "Indexing functions",
              link: "/docs/0.10/api-reference/ponder/indexing-functions",
            },
            {
              text: "API endpoints",
              link: "/docs/0.10/api-reference/ponder/api-endpoints",
            },
            {
              text: "Database reference",
              link: "/docs/0.10/api-reference/ponder/database",
            },
          ],
        },
        {
          text: "@ponder/client",
          link: "/docs/0.10/api-reference/ponder-client",
        },
        {
          text: "@ponder/react",
          link: "/docs/0.10/api-reference/ponder-react",
        },
        {
          text: "@ponder/utils",
          link: "/docs/0.10/api-reference/ponder-utils",
        },
      ],
    },
    {
      text: "Advanced",
      items: [
        { text: "Observability", link: "/docs/0.10/advanced/observability" },
        { text: "Telemetry", link: "/docs/0.10/advanced/telemetry" },
      ],
    },
  ],
} satisfies Sidebar;
