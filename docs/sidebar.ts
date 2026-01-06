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
        { text: "Marble ✨", link: "/docs/production/marble" },
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
      items: [
        { text: "Observability", link: "/docs/advanced/observability" },
        { text: "Telemetry", link: "/docs/advanced/telemetry" },
      ],
    },
  ],
  "/docs/0.15/": [
    {
      text: "Introduction",
      items: [
        { text: "Get started", link: "/docs/0.15/get-started" },
        { text: "Requirements", link: "/docs/0.15/requirements" },
        { text: "Database", link: "/docs/0.15/database" },
        { text: "Migration guide", link: "/docs/0.15/migration-guide" },
      ],
    },
    {
      text: "Config",
      items: [
        { text: "Chains", link: "/docs/0.15/config/chains" },
        { text: "Contracts", link: "/docs/0.15/config/contracts" },
        { text: "Accounts", link: "/docs/0.15/config/accounts" },
        { text: "Block intervals", link: "/docs/0.15/config/block-intervals" },
      ],
    },
    {
      text: "Schema",
      items: [
        { text: "Tables", link: "/docs/0.15/schema/tables" },
        { text: "Relations", link: "/docs/0.15/schema/relations" },
        { text: "Views", link: "/docs/0.15/schema/views" },
      ],
    },
    {
      text: "Indexing",
      items: [
        { text: "Overview", link: "/docs/0.15/indexing/overview" },
        { text: "Write to the database", link: "/docs/0.15/indexing/write" },
        { text: "Read contract data", link: "/docs/0.15/indexing/read-contracts" },
      ],
    },
    {
      text: "Query",
      items: [
        {
          text: "HTTP",
          items: [
            { text: "SQL over HTTP", link: "/docs/0.15/query/sql-over-http" },
            { text: "GraphQL", link: "/docs/0.15/query/graphql" },
            { text: "API endpoints", link: "/docs/0.15/query/api-endpoints" },
          ],
        },
        { text: "Direct SQL", link: "/docs/0.15/query/direct-sql" },
      ],
    },
    {
      text: "Production",
      items: [
        { text: "Marble ✨", link: "/docs/0.15/production/marble" },
        { text: "Railway", link: "/docs/0.15/production/railway" },
        { text: "Self-hosting", link: "/docs/0.15/production/self-hosting" },
      ],
    },
    {
      text: "Guides",
      items: [
        { text: "Factory pattern", link: "/docs/0.15/guides/factory" },
        { text: "Isolated indexing", link: "/docs/0.15/guides/isolated-indexing" },
        { text: "Call traces", link: "/docs/0.15/guides/call-traces" },
        { text: "Transaction receipts", link: "/docs/0.15/guides/receipts" },
        { text: "Time-series data", link: "/docs/0.15/guides/time-series" },
        { text: "Offchain data", link: "/docs/0.15/guides/offchain-data" },
        { text: "Foundry", link: "/docs/0.15/guides/foundry" },
      ],
    },
    {
      text: "API reference",
      items: [
        { text: "create-ponder", link: "/docs/0.15/api-reference/create-ponder" },
        {
          text: "ponder",
          items: [
            {
              text: "CLI (dev, start, serve)",
              link: "/docs/0.15/api-reference/ponder/cli",
            },
            {
              text: "ponder.config.ts",
              link: "/docs/0.15/api-reference/ponder/config",
            },
            {
              text: "ponder.schema.ts",
              link: "/docs/0.15/api-reference/ponder/schema",
            },
            {
              text: "Indexing functions",
              link: "/docs/0.15/api-reference/ponder/indexing-functions",
            },
            {
              text: "API endpoints",
              link: "/docs/0.15/api-reference/ponder/api-endpoints",
            },
            {
              text: "Database reference",
              link: "/docs/0.15/api-reference/ponder/database",
            },
          ],
        },
        { text: "@ponder/client", link: "/docs/0.15/api-reference/ponder-client" },
        { text: "@ponder/react", link: "/docs/0.15/api-reference/ponder-react" },
        { text: "@ponder/utils", link: "/docs/0.15/api-reference/ponder-utils" },
      ],
    },
    {
      text: "Advanced",
      items: [
        { text: "Observability", link: "/docs/0.15/advanced/observability" },
        { text: "Telemetry", link: "/docs/0.15/advanced/telemetry" },
      ],
    },
  ],
  "/docs/0.14/": [
    {
      text: "Introduction",
      items: [
        { text: "Get started", link: "/docs/0.14/get-started" },
        { text: "Requirements", link: "/docs/0.14/requirements" },
        { text: "Database", link: "/docs/0.14/database" },
        { text: "Migration guide", link: "/docs/0.14/migration-guide" },
      ],
    },
    {
      text: "Config",
      items: [
        { text: "Chains", link: "/docs/0.14/config/chains" },
        { text: "Contracts", link: "/docs/0.14/config/contracts" },
        { text: "Accounts", link: "/docs/0.14/config/accounts" },
        { text: "Block intervals", link: "/docs/0.14/config/block-intervals" },
      ],
    },
    {
      text: "Schema",
      items: [
        { text: "Tables", link: "/docs/0.14/schema/tables" },
        { text: "Relations", link: "/docs/0.14/schema/relations" },
        { text: "Views", link: "/docs/0.14/schema/views" },
      ],
    },
    {
      text: "Indexing",
      items: [
        { text: "Overview", link: "/docs/0.14/indexing/overview" },
        { text: "Write to the database", link: "/docs/0.14/indexing/write" },
        { text: "Read contract data", link: "/docs/0.14/indexing/read-contracts" },
      ],
    },
    {
      text: "Query",
      items: [
        {
          text: "HTTP",
          items: [
            { text: "SQL over HTTP", link: "/docs/0.14/query/sql-over-http" },
            { text: "GraphQL", link: "/docs/0.14/query/graphql" },
            { text: "API endpoints", link: "/docs/0.14/query/api-endpoints" },
          ],
        },
        { text: "Direct SQL", link: "/docs/0.14/query/direct-sql" },
      ],
    },
    {
      text: "Production",
      items: [
        { text: "Marble ✨", link: "/docs/0.14/production/marble" },
        { text: "Railway", link: "/docs/0.14/production/railway" },
        { text: "Self-hosting", link: "/docs/0.14/production/self-hosting" },
      ],
    },
    {
      text: "Guides",
      items: [
        { text: "Factory pattern", link: "/docs/0.14/guides/factory" },
        { text: "Call traces", link: "/docs/0.14/guides/call-traces" },
        { text: "Transaction receipts", link: "/docs/0.14/guides/receipts" },
        { text: "Time-series data", link: "/docs/0.14/guides/time-series" },
        { text: "Offchain data", link: "/docs/0.14/guides/offchain-data" },
        { text: "Foundry", link: "/docs/0.14/guides/foundry" },
      ],
    },
    {
      text: "API reference",
      items: [
        { text: "create-ponder", link: "/docs/0.14/api-reference/create-ponder" },
        {
          text: "ponder",
          items: [
            {
              text: "CLI (dev, start, serve)",
              link: "/docs/0.14/api-reference/ponder/cli",
            },
            {
              text: "ponder.config.ts",
              link: "/docs/0.14/api-reference/ponder/config",
            },
            {
              text: "ponder.schema.ts",
              link: "/docs/0.14/api-reference/ponder/schema",
            },
            {
              text: "Indexing functions",
              link: "/docs/0.14/api-reference/ponder/indexing-functions",
            },
            {
              text: "API endpoints",
              link: "/docs/0.14/api-reference/ponder/api-endpoints",
            },
            {
              text: "Database reference",
              link: "/docs/0.14/api-reference/ponder/database",
            },
          ],
        },
        { text: "@ponder/client", link: "/docs/0.14/api-reference/ponder-client" },
        { text: "@ponder/react", link: "/docs/0.14/api-reference/ponder-react" },
        { text: "@ponder/utils", link: "/docs/0.14/api-reference/ponder-utils" },
      ],
    },
    {
      text: "Advanced",
      items: [
        { text: "Observability", link: "/docs/0.14/advanced/observability" },
        { text: "Telemetry", link: "/docs/0.14/advanced/telemetry" },
      ],
    },
  ],
  "/docs/0.12/": [
    {
      text: "Introduction",
      items: [
        { text: "Get started", link: "/docs/0.12/get-started" },
        { text: "Requirements", link: "/docs/0.12/requirements" },
        { text: "Database", link: "/docs/0.12/database" },
        { text: "Migration guide", link: "/docs/0.12/migration-guide" },
      ],
    },
    {
      text: "Config",
      items: [
        { text: "Chains", link: "/docs/0.12/config/chains" },
        { text: "Contracts", link: "/docs/0.12/config/contracts" },
        { text: "Accounts", link: "/docs/0.12/config/accounts" },
        { text: "Block intervals", link: "/docs/0.12/config/block-intervals" },
      ],
    },
    {
      text: "Schema",
      items: [
        { text: "Tables", link: "/docs/0.12/schema/tables" },
        { text: "Relations", link: "/docs/0.12/schema/relations" },
      ],
    },
    {
      text: "Indexing",
      items: [
        { text: "Overview", link: "/docs/0.12/indexing/overview" },
        { text: "Write to the database", link: "/docs/0.12/indexing/write" },
        { text: "Read contract data", link: "/docs/0.12/indexing/read-contracts" },
      ],
    },
    {
      text: "Query",
      items: [
        {
          text: "HTTP",
          items: [
            { text: "SQL over HTTP", link: "/docs/0.12/query/sql-over-http" },
            { text: "GraphQL", link: "/docs/0.12/query/graphql" },
            { text: "API endpoints", link: "/docs/0.12/query/api-endpoints" },
          ],
        },
        { text: "Direct SQL", link: "/docs/0.12/query/direct-sql" },
      ],
    },
    {
      text: "Production",
      items: [
        { text: "Marble ✨", link: "/docs/0.12/production/marble" },
        { text: "Railway", link: "/docs/0.12/production/railway" },
        { text: "Self-hosting", link: "/docs/0.12/production/self-hosting" },
      ],
    },
    {
      text: "Guides",
      items: [
        { text: "Offchain data", link: "/docs/0.12/guides/offchain-data" },
        { text: "Factory pattern", link: "/docs/0.12/guides/factory" },
        { text: "Call traces", link: "/docs/0.12/guides/call-traces" },
        { text: "Transaction receipts", link: "/docs/0.12/guides/receipts" },
        { text: "Time-series data", link: "/docs/0.12/guides/time-series" },
        { text: "Foundry", link: "/docs/0.12/guides/foundry" },
      ],
    },
    {
      text: "API reference",
      items: [
        { text: "create-ponder", link: "/docs/0.12/api-reference/create-ponder" },
        {
          text: "ponder",
          items: [
            {
              text: "CLI (dev, start, serve)",
              link: "/docs/0.12/api-reference/ponder/cli",
            },
            {
              text: "ponder.config.ts",
              link: "/docs/0.12/api-reference/ponder/config",
            },
            {
              text: "ponder.schema.ts",
              link: "/docs/0.12/api-reference/ponder/schema",
            },
            {
              text: "Indexing functions",
              link: "/docs/0.12/api-reference/ponder/indexing-functions",
            },
            {
              text: "API endpoints",
              link: "/docs/0.12/api-reference/ponder/api-endpoints",
            },
            {
              text: "Database reference",
              link: "/docs/0.12/api-reference/ponder/database",
            },
          ],
        },
        { text: "@ponder/client", link: "/docs/0.12/api-reference/ponder-client" },
        { text: "@ponder/react", link: "/docs/0.12/api-reference/ponder-react" },
        { text: "@ponder/utils", link: "/docs/0.12/api-reference/ponder-utils" },
      ],
    },
    {
      text: "Advanced",
      items: [
        { text: "Observability", link: "/docs/0.12/advanced/observability" },
        { text: "Telemetry", link: "/docs/0.12/advanced/telemetry" },
      ],
    },
  ],
  "/docs/0.11/": [
    {
      text: "Introduction",
      items: [
        { text: "Get started", link: "/docs/0.11/get-started" },
        { text: "Requirements", link: "/docs/0.11/requirements" },
        { text: "Database", link: "/docs/0.11/database" },
        { text: "Migration guide", link: "/docs/0.11/migration-guide" },
      ],
    },
    {
      text: "Config",
      items: [
        { text: "Chains", link: "/docs/0.11/config/chains" },
        { text: "Contracts", link: "/docs/0.11/config/contracts" },
        { text: "Accounts", link: "/docs/0.11/config/accounts" },
        { text: "Block intervals", link: "/docs/0.11/config/block-intervals" },
      ],
    },
    {
      text: "Schema",
      items: [
        { text: "Tables", link: "/docs/0.11/schema/tables" },
        { text: "Relations", link: "/docs/0.11/schema/relations" },
      ],
    },
    {
      text: "Indexing",
      items: [
        { text: "Overview", link: "/docs/0.11/indexing/overview" },
        { text: "Write to the database", link: "/docs/0.11/indexing/write" },
        {
          text: "Read contract data",
          link: "/docs/0.11/indexing/read-contracts",
        },
      ],
    },
    {
      text: "Query",
      items: [
        {
          text: "HTTP",
          items: [
            { text: "SQL over HTTP", link: "/docs/0.11/query/sql-over-http" },
            { text: "GraphQL", link: "/docs/0.11/query/graphql" },
            { text: "API endpoints", link: "/docs/0.11/query/api-endpoints" },
          ],
        },
        { text: "Direct SQL", link: "/docs/0.11/query/direct-sql" },
      ],
    },
    {
      text: "Production",
      items: [
        { text: "Marble ✨", link: "/docs/0.11/production/marble" },
        { text: "Railway", link: "/docs/0.11/production/railway" },
        { text: "Self-hosting", link: "/docs/0.11/production/self-hosting" },
      ],
    },
    {
      text: "Guides",
      items: [
        { text: "Offchain data", link: "/docs/0.11/guides/offchain-data" },
        { text: "Factory pattern", link: "/docs/0.11/guides/factory" },
        { text: "Call traces", link: "/docs/0.11/guides/call-traces" },
        { text: "Transaction receipts", link: "/docs/0.11/guides/receipts" },
        { text: "Time-series data", link: "/docs/0.11/guides/time-series" },
        { text: "Foundry", link: "/docs/0.11/guides/foundry" },
      ],
    },
    {
      text: "API reference",
      items: [
        {
          text: "create-ponder",
          link: "/docs/0.11/api-reference/create-ponder",
        },
        {
          text: "ponder",
          items: [
            {
              text: "CLI (dev, start, serve)",
              link: "/docs/0.11/api-reference/ponder/cli",
            },
            {
              text: "ponder.config.ts",
              link: "/docs/0.11/api-reference/ponder/config",
            },
            {
              text: "ponder.schema.ts",
              link: "/docs/0.11/api-reference/ponder/schema",
            },
            {
              text: "Indexing functions",
              link: "/docs/0.11/api-reference/ponder/indexing-functions",
            },
            {
              text: "API endpoints",
              link: "/docs/0.11/api-reference/ponder/api-endpoints",
            },
            {
              text: "Database reference",
              link: "/docs/0.11/api-reference/ponder/database",
            },
          ],
        },
        {
          text: "@ponder/client",
          link: "/docs/0.11/api-reference/ponder-client",
        },
        {
          text: "@ponder/react",
          link: "/docs/0.11/api-reference/ponder-react",
        },
        {
          text: "@ponder/utils",
          link: "/docs/0.11/api-reference/ponder-utils",
        },
      ],
    },
    {
      text: "Advanced",
      items: [
        { text: "Observability", link: "/docs/0.11/advanced/observability" },
        { text: "Telemetry", link: "/docs/0.11/advanced/telemetry" },
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


export function getCanonicalSubpath(subpath: string): string | null {
  if (subpath.startsWith("/docs/0.15")) {
    return canonicalSubpathsMap0_15[subpath] ?? null;
  }

  if (subpath.startsWith("/docs/0.14")) {
    return canonicalSubpathsMap0_14[subpath] ?? null;
  }

  if (subpath.startsWith("/docs/0.12")) {
    return canonicalSubpathsMap0_12[subpath] ?? null;
  }

  if (subpath.startsWith("/docs/0.11")) {
    return canonicalSubpathsMap0_11[subpath] ?? null;
  }

  if (subpath.startsWith("/docs/0.10")) {
    return canonicalSubpathsMap0_10[subpath] ?? null;
  }

  return null;
}

export function getBestSubpathForVersion(
  subpath: string,
  fromVersion: "0.10" | "0.11" | "0.12" | "0.14" | "0.15" | "latest",
  toVersion: "0.10" | "0.11" | "0.12" | "0.14" | "0.15" | "latest",
): string {
  if (toVersion === "latest") {
    const canonical = getCanonicalSubpath(subpath);
    return canonical ?? "/docs/get-started";
  }

  if (fromVersion === "latest") {
    if (toVersion === "0.15") {
      for (const [v15Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_15)) {
        if (canonicalPath === subpath) {
          return v15Path;
        }
      }
    } else if (toVersion === "0.14") {
      for (const [v14Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_14)) {
        if (canonicalPath === subpath) {
          return v14Path;
        }
      }
    } else if (toVersion === "0.12") {
      for (const [v12Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_12)) {
        if (canonicalPath === subpath) {
          return v12Path;
        }
      }
    } else if (toVersion === "0.11") {
      for (const [v11Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_11)) {
        if (canonicalPath === subpath) {
          return v11Path;
        }
      }
    } else if (toVersion === "0.10") {
      for (const [v10Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_10)) {
        if (canonicalPath === subpath) {
          return v10Path;
        }
      }
    }
    return `/docs/${toVersion}/get-started`;
  }

  const canonical = getCanonicalSubpath(subpath);
  if (!canonical) {
    return `/docs/${toVersion}/get-started`;
  }

  if (toVersion === "0.15") {
    for (const [v15Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_15)) {
      if (canonicalPath === canonical) {
        return v15Path;
      }
    }
  } else if (toVersion === "0.14") {
    for (const [v14Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_14)) {
      if (canonicalPath === canonical) {
        return v14Path;
      }
    }
  } else if (toVersion === "0.12") {
    for (const [v12Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_12)) {
      if (canonicalPath === canonical) {
        return v12Path;
      }
    }
  } else if (toVersion === "0.11") {
    for (const [v11Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_11)) {
      if (canonicalPath === canonical) {
        return v11Path;
      }
    }
  } else if (toVersion === "0.10") {
    for (const [v10Path, canonicalPath] of Object.entries(canonicalSubpathsMap0_10)) {
      if (canonicalPath === canonical) {
        return v10Path;
      }
    }
  }

  return `/docs/${toVersion}/get-started`;
}

const subpathsLatest = getNestedSubpaths(sidebar["/docs/"]);

const canonicalSubpathsMap0_15: { [key: string]: string | undefined } = {
  "/docs/0.15/get-started": "/docs/get-started",
  "/docs/0.15/requirements": "/docs/requirements",
  "/docs/0.15/database": "/docs/database",
  "/docs/0.15/migration-guide": "/docs/migration-guide",
  "/docs/0.15/config/chains": "/docs/config/chains",
  "/docs/0.15/config/contracts": "/docs/config/contracts",
  "/docs/0.15/config/accounts": "/docs/config/accounts",
  "/docs/0.15/config/block-intervals": "/docs/config/block-intervals",
  "/docs/0.15/schema/tables": "/docs/schema/tables",
  "/docs/0.15/schema/relations": "/docs/schema/relations",
  "/docs/0.15/schema/views": "/docs/schema/views",
  "/docs/0.15/indexing/overview": "/docs/indexing/overview",
  "/docs/0.15/indexing/write": "/docs/indexing/write",
  "/docs/0.15/indexing/read-contracts": "/docs/indexing/read-contracts",
  "/docs/0.15/query/sql-over-http": "/docs/query/sql-over-http",
  "/docs/0.15/query/graphql": "/docs/query/graphql",
  "/docs/0.15/query/api-endpoints": "/docs/query/api-endpoints",
  "/docs/0.15/query/direct-sql": "/docs/query/direct-sql",
  "/docs/0.15/production/marble": "/docs/production/marble",
  "/docs/0.15/production/railway": "/docs/production/railway",
  "/docs/0.15/production/self-hosting": "/docs/production/self-hosting",
  "/docs/0.15/guides/factory": "/docs/guides/factory",
  "/docs/0.15/guides/isolated-indexing": "/docs/guides/isolated-indexing",
  "/docs/0.15/guides/call-traces": "/docs/guides/call-traces",
  "/docs/0.15/guides/receipts": "/docs/guides/receipts",
  "/docs/0.15/guides/time-series": "/docs/guides/time-series",
  "/docs/0.15/guides/offchain-data": "/docs/guides/offchain-data",
  "/docs/0.15/guides/foundry": "/docs/guides/foundry",
  "/docs/0.15/api-reference/create-ponder": "/docs/api-reference/create-ponder",
  "/docs/0.15/api-reference/ponder/cli": "/docs/api-reference/ponder/cli",
  "/docs/0.15/api-reference/ponder/config": "/docs/api-reference/ponder/config",
  "/docs/0.15/api-reference/ponder/schema": "/docs/api-reference/ponder/schema",
  "/docs/0.15/api-reference/ponder/indexing-functions":
    "/docs/api-reference/ponder/indexing-functions",
  "/docs/0.15/api-reference/ponder/api-endpoints":
    "/docs/api-reference/ponder/api-endpoints",
  "/docs/0.15/api-reference/ponder/database":
    "/docs/api-reference/ponder/database",
  "/docs/0.15/api-reference/ponder-client": "/docs/api-reference/ponder-client",
  "/docs/0.15/api-reference/ponder-react": "/docs/api-reference/ponder-react",
  "/docs/0.15/api-reference/ponder-utils": "/docs/api-reference/ponder-utils",
  "/docs/0.15/advanced/observability": "/docs/advanced/observability",
  "/docs/0.15/advanced/telemetry": "/docs/advanced/telemetry",
};

const subpaths0_15 = getNestedSubpaths(sidebar["/docs/0.15/"]);

for (const subpath of subpaths0_15) {
  const canonicalSubpath = canonicalSubpathsMap0_15[subpath];
  if (canonicalSubpath === undefined) {
    throw new Error(`No canonical path registered for 0.15 path (${subpath}).`);
  }

  if (!subpathsLatest.includes(canonicalSubpath)) {
    throw new Error(
      `Invalid canonical path registered for 0.15 path (${subpath}). Suggested path (${canonicalSubpath}) does not exist.`
    );
  }
}

const canonicalSubpathsMap0_14: { [key: string]: string | undefined } = {
  "/docs/0.14/get-started": "/docs/get-started",
  "/docs/0.14/requirements": "/docs/requirements",
  "/docs/0.14/database": "/docs/database",
  "/docs/0.14/migration-guide": "/docs/migration-guide",
  "/docs/0.14/config/chains": "/docs/config/chains",
  "/docs/0.14/config/contracts": "/docs/config/contracts",
  "/docs/0.14/config/accounts": "/docs/config/accounts",
  "/docs/0.14/config/block-intervals": "/docs/config/block-intervals",
  "/docs/0.14/schema/tables": "/docs/schema/tables",
  "/docs/0.14/schema/relations": "/docs/schema/relations",
  "/docs/0.14/schema/views": "/docs/schema/views",
  "/docs/0.14/indexing/overview": "/docs/indexing/overview",
  "/docs/0.14/indexing/write": "/docs/indexing/write",
  "/docs/0.14/indexing/read-contracts": "/docs/indexing/read-contracts",
  "/docs/0.14/query/sql-over-http": "/docs/query/sql-over-http",
  "/docs/0.14/query/graphql": "/docs/query/graphql",
  "/docs/0.14/query/api-endpoints": "/docs/query/api-endpoints",
  "/docs/0.14/query/direct-sql": "/docs/query/direct-sql",
  "/docs/0.14/production/marble": "/docs/production/marble",
  "/docs/0.14/production/railway": "/docs/production/railway",
  "/docs/0.14/production/self-hosting": "/docs/production/self-hosting",
  "/docs/0.14/guides/offchain-data": "/docs/guides/offchain-data",
  "/docs/0.14/guides/factory": "/docs/guides/factory",
  "/docs/0.14/guides/call-traces": "/docs/guides/call-traces",
  "/docs/0.14/guides/receipts": "/docs/guides/receipts",
  "/docs/0.14/guides/time-series": "/docs/guides/time-series",
  "/docs/0.14/guides/foundry": "/docs/guides/foundry",
  "/docs/0.14/api-reference/create-ponder": "/docs/api-reference/create-ponder",
  "/docs/0.14/api-reference/ponder/cli": "/docs/api-reference/ponder/cli",
  "/docs/0.14/api-reference/ponder/config": "/docs/api-reference/ponder/config",
  "/docs/0.14/api-reference/ponder/schema": "/docs/api-reference/ponder/schema",
  "/docs/0.14/api-reference/ponder/indexing-functions":
    "/docs/api-reference/ponder/indexing-functions",
  "/docs/0.14/api-reference/ponder/api-endpoints":
    "/docs/api-reference/ponder/api-endpoints",
  "/docs/0.14/api-reference/ponder/database":
    "/docs/api-reference/ponder/database",
  "/docs/0.14/api-reference/ponder-client": "/docs/api-reference/ponder-client",
  "/docs/0.14/api-reference/ponder-react": "/docs/api-reference/ponder-react",
  "/docs/0.14/api-reference/ponder-utils": "/docs/api-reference/ponder-utils",
  "/docs/0.14/advanced/observability": "/docs/advanced/observability",
  "/docs/0.14/advanced/telemetry": "/docs/advanced/telemetry",
};

const subpaths0_14 = getNestedSubpaths(sidebar["/docs/0.14/"]);

for (const subpath of subpaths0_14) {
  const canonicalSubpath = canonicalSubpathsMap0_14[subpath];
  if (canonicalSubpath === undefined) {
    throw new Error(`No canonical path registered for 0.14 path (${subpath}).`);
  }

  if (!subpathsLatest.includes(canonicalSubpath)) {
    throw new Error(
      `Invalid canonical path registered for 0.14 path (${subpath}). Suggested path (${canonicalSubpath}) does not exist.`
    );
  }
}

const canonicalSubpathsMap0_12: { [key: string]: string | undefined } = {
  "/docs/0.12/get-started": "/docs/get-started",
  "/docs/0.12/requirements": "/docs/requirements",
  "/docs/0.12/database": "/docs/database",
  "/docs/0.12/migration-guide": "/docs/migration-guide",
  "/docs/0.12/config/chains": "/docs/config/chains",
  "/docs/0.12/config/contracts": "/docs/config/contracts",
  "/docs/0.12/config/accounts": "/docs/config/accounts",
  "/docs/0.12/config/block-intervals": "/docs/config/block-intervals",
  "/docs/0.12/schema/tables": "/docs/schema/tables",
  "/docs/0.12/schema/relations": "/docs/schema/relations",
  "/docs/0.12/indexing/overview": "/docs/indexing/overview",
  "/docs/0.12/indexing/write": "/docs/indexing/write",
  "/docs/0.12/indexing/read-contracts": "/docs/indexing/read-contracts",
  "/docs/0.12/query/sql-over-http": "/docs/query/sql-over-http",
  "/docs/0.12/query/graphql": "/docs/query/graphql",
  "/docs/0.12/query/api-endpoints": "/docs/query/api-endpoints",
  "/docs/0.12/query/direct-sql": "/docs/query/direct-sql",
  "/docs/0.12/production/marble": "/docs/production/marble",
  "/docs/0.12/production/railway": "/docs/production/railway",
  "/docs/0.12/production/self-hosting": "/docs/production/self-hosting",
  "/docs/0.12/guides/offchain-data": "/docs/guides/offchain-data",
  "/docs/0.12/guides/factory": "/docs/guides/factory",
  "/docs/0.12/guides/call-traces": "/docs/guides/call-traces",
  "/docs/0.12/guides/receipts": "/docs/guides/receipts",
  "/docs/0.12/guides/time-series": "/docs/guides/time-series",
  "/docs/0.12/guides/foundry": "/docs/guides/foundry",
  "/docs/0.12/api-reference/create-ponder": "/docs/api-reference/create-ponder",
  "/docs/0.12/api-reference/ponder/cli": "/docs/api-reference/ponder/cli",
  "/docs/0.12/api-reference/ponder/config": "/docs/api-reference/ponder/config",
  "/docs/0.12/api-reference/ponder/schema": "/docs/api-reference/ponder/schema",
  "/docs/0.12/api-reference/ponder/indexing-functions":
    "/docs/api-reference/ponder/indexing-functions",
  "/docs/0.12/api-reference/ponder/api-endpoints":
    "/docs/api-reference/ponder/api-endpoints",
  "/docs/0.12/api-reference/ponder/database":
    "/docs/api-reference/ponder/database",
  "/docs/0.12/api-reference/ponder-client": "/docs/api-reference/ponder-client",
  "/docs/0.12/api-reference/ponder-react": "/docs/api-reference/ponder-react",
  "/docs/0.12/api-reference/ponder-utils": "/docs/api-reference/ponder-utils",
  "/docs/0.12/advanced/observability": "/docs/advanced/observability",
  "/docs/0.12/advanced/telemetry": "/docs/advanced/telemetry",
};

const subpaths0_12 = getNestedSubpaths(sidebar["/docs/0.12/"]);

for (const subpath of subpaths0_12) {
  const canonicalSubpath = canonicalSubpathsMap0_12[subpath];
  if (canonicalSubpath === undefined) {
    throw new Error(`No canonical path registered for 0.12 path (${subpath}).`);
  }

  if (!subpathsLatest.includes(canonicalSubpath)) {
    throw new Error(
      `Invalid canonical path registered for 0.12 path (${subpath}). Suggested path (${canonicalSubpath}) does not exist.`
    );
  }
}

const canonicalSubpathsMap0_11: { [key: string]: string | undefined } = {
  "/docs/0.11/get-started": "/docs/get-started",
  "/docs/0.11/requirements": "/docs/requirements",
  "/docs/0.11/database": "/docs/database",
  "/docs/0.11/migration-guide": "/docs/migration-guide",
  "/docs/0.11/config/chains": "/docs/config/chains",
  "/docs/0.11/config/contracts": "/docs/config/contracts",
  "/docs/0.11/config/accounts": "/docs/config/accounts",
  "/docs/0.11/config/block-intervals": "/docs/config/block-intervals",
  "/docs/0.11/schema/tables": "/docs/schema/tables",
  "/docs/0.11/schema/relations": "/docs/schema/relations",
  "/docs/0.11/indexing/overview": "/docs/indexing/overview",
  "/docs/0.11/indexing/write": "/docs/indexing/write",
  "/docs/0.11/indexing/read-contracts": "/docs/indexing/read-contracts",
  "/docs/0.11/query/sql-over-http": "/docs/query/sql-over-http",
  "/docs/0.11/query/graphql": "/docs/query/graphql",
  "/docs/0.11/query/api-endpoints": "/docs/query/api-endpoints",
  "/docs/0.11/query/direct-sql": "/docs/query/direct-sql",
  "/docs/0.11/production/marble": "/docs/production/marble",
  "/docs/0.11/production/railway": "/docs/production/railway",
  "/docs/0.11/production/self-hosting": "/docs/production/self-hosting",
  "/docs/0.11/guides/offchain-data": "/docs/guides/offchain-data",
  "/docs/0.11/guides/factory": "/docs/guides/factory",
  "/docs/0.11/guides/call-traces": "/docs/guides/call-traces",
  "/docs/0.11/guides/receipts": "/docs/guides/receipts",
  "/docs/0.11/guides/time-series": "/docs/guides/time-series",
  "/docs/0.11/guides/foundry": "/docs/guides/foundry",
  "/docs/0.11/api-reference/create-ponder": "/docs/api-reference/create-ponder",
  "/docs/0.11/api-reference/ponder/cli": "/docs/api-reference/ponder/cli",
  "/docs/0.11/api-reference/ponder/config": "/docs/api-reference/ponder/config",
  "/docs/0.11/api-reference/ponder/schema": "/docs/api-reference/ponder/schema",
  "/docs/0.11/api-reference/ponder/indexing-functions":
    "/docs/api-reference/ponder/indexing-functions",
  "/docs/0.11/api-reference/ponder/api-endpoints":
    "/docs/api-reference/ponder/api-endpoints",
  "/docs/0.11/api-reference/ponder/database":
    "/docs/api-reference/ponder/database",
  "/docs/0.11/api-reference/ponder-client": "/docs/api-reference/ponder-client",
  "/docs/0.11/api-reference/ponder-react": "/docs/api-reference/ponder-react",
  "/docs/0.11/api-reference/ponder-utils": "/docs/api-reference/ponder-utils",
  "/docs/0.11/advanced/observability": "/docs/advanced/observability",
  "/docs/0.11/advanced/telemetry": "/docs/advanced/telemetry",
};

const subpaths0_11 = getNestedSubpaths(sidebar["/docs/0.11/"]);

for (const subpath of subpaths0_11) {
  const canonicalSubpath = canonicalSubpathsMap0_11[subpath];
  if (canonicalSubpath === undefined) {
    throw new Error(`No canonical path registered for 0.11 path (${subpath}).`);
  }

  if (!subpathsLatest.includes(canonicalSubpath)) {
    throw new Error(
      `Invalid canonical path registered for 0.11 path (${subpath}). Suggested path (${canonicalSubpath}) does not exist.`
    );
  }
}

const canonicalSubpathsMap0_10: { [key: string]: string | undefined } = {
  "/docs/0.10/get-started": "/docs/get-started",
  "/docs/0.10/requirements": "/docs/requirements",
  "/docs/0.10/database": "/docs/database",
  "/docs/0.10/migration-guide": "/docs/migration-guide",
  "/docs/0.10/config/networks": "/docs/config/chains",
  "/docs/0.10/config/contracts": "/docs/config/contracts",
  "/docs/0.10/config/accounts": "/docs/config/accounts",
  "/docs/0.10/config/block-intervals": "/docs/config/block-intervals",
  "/docs/0.10/schema/tables": "/docs/schema/tables",
  "/docs/0.10/schema/relations": "/docs/schema/relations",
  "/docs/0.10/indexing/overview": "/docs/indexing/overview",
  "/docs/0.10/indexing/write": "/docs/indexing/write",
  "/docs/0.10/indexing/read-contracts": "/docs/indexing/read-contracts",
  "/docs/0.10/query/graphql": "/docs/query/graphql",
  "/docs/0.10/query/sql-client": "/docs/query/sql-over-http",
  "/docs/0.10/query/api-endpoints": "/docs/query/api-endpoints",
  "/docs/0.10/query/direct-sql": "/docs/query/direct-sql",
  "/docs/0.10/production/railway": "/docs/production/railway",
  "/docs/0.10/production/self-hosting": "/docs/production/self-hosting",
  "/docs/0.10/guides/factory": "/docs/guides/factory",
  "/docs/0.10/guides/call-traces": "/docs/guides/call-traces",
  "/docs/0.10/guides/receipts": "/docs/guides/receipts",
  "/docs/0.10/guides/time-series": "/docs/guides/time-series",
  "/docs/0.10/guides/foundry": "/docs/guides/foundry",
  "/docs/0.10/api-reference/create-ponder": "/docs/api-reference/create-ponder",
  "/docs/0.10/api-reference/ponder/cli": "/docs/api-reference/ponder/cli",
  "/docs/0.10/api-reference/ponder/config": "/docs/api-reference/ponder/config",
  "/docs/0.10/api-reference/ponder/schema": "/docs/api-reference/ponder/schema",
  "/docs/0.10/api-reference/ponder/indexing-functions":
    "/docs/api-reference/ponder/indexing-functions",
  "/docs/0.10/api-reference/ponder/api-endpoints":
    "/docs/api-reference/ponder/api-endpoints",
  "/docs/0.10/api-reference/ponder/database":
    "/docs/api-reference/ponder/database",
  "/docs/0.10/api-reference/ponder-client": "/docs/api-reference/ponder-client",
  "/docs/0.10/api-reference/ponder-react": "/docs/api-reference/ponder-react",
  "/docs/0.10/api-reference/ponder-utils": "/docs/api-reference/ponder-utils",
  "/docs/0.10/advanced/observability": "/docs/advanced/observability",
  "/docs/0.10/advanced/telemetry": "/docs/advanced/telemetry",
};

const subpaths0_10 = getNestedSubpaths(sidebar["/docs/0.10/"]);

for (const subpath of subpaths0_10) {
  const canonicalSubpath = canonicalSubpathsMap0_10[subpath];
  if (canonicalSubpath === undefined) {
    throw new Error(`No canonical path registered for 0.10 path (${subpath}).`);
  }

  if (!subpathsLatest.includes(canonicalSubpath)) {
    throw new Error(
      `Invalid canonical path registered for 0.10 path (${subpath}). Suggested path (${canonicalSubpath}) does not exist.`
    );
  }
}

function getNestedSubpaths(items: any[]): string[] {
  const links: string[] = [];
  
  for (const item of items) {
    if (item.link) {
      links.push(item.link);
    }
    if (item.items) {
      links.push(...getNestedSubpaths(item.items));
    }
  }
  
  return links;
}