import fs from "node:fs";
import path from "node:path";
import type { AbiEvent, AbiParameter } from "viem";
import type {
  AppPlan,
  ChainPlan,
  ContractPlan,
  Plan,
  RangePlan,
} from "./plan.js";
import {
  DEAD,
  EOAS,
  factoryAbi,
  getFactory,
  getTokens,
  poolAbi,
  tokenAbi,
} from "./shared.js";

const ABIS = { token: tokenAbi, pool: poolAbi, factory: factoryAbi } as const;
const ABI_NAMES = {
  token: "tokenAbi",
  pool: "poolAbi",
  factory: "factoryAbi",
} as const;

/**
 * A column of the table of an event. `value` is the expression of its value
 * in the indexing function, which has `event` in scope.
 */
type Column = { name: string; type: string; value: string };

/** An event of an app. Setup events have no table. */
type AppEvent =
  | { kind: "setup"; name: string }
  | { kind: "table"; name: string; table: string; columns: Column[] };

/** The table of an event: `Token:Transfer` -> `token_transfer`. */
export const tableName = (event: string) =>
  event
    .replace(/\.(\w+)\(\)$/, "_$1_call")
    .replace(/[:.]/g, "_")
    .replace(/[()]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();

/** The export of the table of an event: `Token:Transfer` -> `tokenTransfer`. */
const tableExport = (event: string) =>
  tableName(event).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** The column type of an ABI parameter. */
const columnType = (param: AbiParameter): string => {
  const type = param.type;
  if (type.endsWith("[]")) {
    const inner = columnType({ ...param, type: type.slice(0, -2) });
    return inner === "t.json()" ? "t.json()" : `${inner}.array()`;
  }
  if (type === "address") return "t.hex()";
  if (type === "bool") return "t.boolean()";
  if (type === "string") return "t.text()";
  if (type.startsWith("bytes")) return "t.hex()";
  if (type === "tuple") return "t.json()";
  const bits = Number(type.replace(/^u?int/, "") || "256");
  if (bits <= 31) return "t.integer()";
  if (bits <= 48) return "t.doublePrecision()";
  return "t.bigint()";
};

/** A column, with `toJson` around the value of a `t.json()` column. */
const column = (name: string, type: string, value: string): Column => ({
  name,
  type,
  value: type === "t.json()" ? `toJson(${value})` : value,
});

/** The events of `app`, and the columns of their tables. */
const getAppEvents = (app: AppPlan): AppEvent[] => {
  const events: AppEvent[] = [];
  const push = (name: string, columns: Column[]) =>
    events.push({
      kind: "table",
      name,
      table: tableName(name),
      columns: [
        column("blockNumber", "t.bigint().notNull()", "event.block.number"),
        ...columns,
      ],
    });

  for (const contract of app.contracts) {
    const abi = ABIS[contract.kind];
    if (contract.setup) {
      events.push({ kind: "setup", name: `${contract.name}:setup` });
    }
    for (const item of abi) {
      if (
        item.type !== "event" ||
        contract.events.includes(item.name) === false
      )
        continue;
      push(
        `${contract.name}:${item.name}`,
        (item as AbiEvent).inputs.map((input) =>
          // Note: The prefix avoids a collision of an arg named `id` with the
          // primary key.
          column(
            `arg${input.name![0]!.toUpperCase()}${input.name!.slice(1)}`,
            columnType(input),
            `event.args.${input.name}`,
          ),
        ),
      );
    }
    for (const fn of contract.functions) {
      push(`${contract.name}.${fn}()`, [
        column("args", "t.json()", "event.args"),
        column("result", "t.json()", "event.result"),
      ]);
    }
  }
  for (const account of app.accounts) {
    for (const event of account.events) {
      const name = `${account.name}:${event}`;
      if (event.startsWith("transaction")) {
        push(name, [
          column("hash", "t.hex()", "event.transaction.hash"),
          column("from", "t.hex()", "event.transaction.from"),
          column("to", "t.hex()", "event.transaction.to"),
          column("value", "t.bigint()", "event.transaction.value"),
        ]);
      } else {
        push(name, [
          column("from", "t.hex()", "event.transfer.from"),
          column("to", "t.hex()", "event.transfer.to"),
          column("value", "t.bigint()", "event.transfer.value"),
        ]);
      }
    }
  }
  for (const block of app.blocks) {
    push(`${block.name}:block`, [
      column("hash", "t.hex()", "event.block.hash"),
      column("timestamp", "t.bigint()", "event.block.timestamp"),
    ]);
  }
  return events;
};

const range = ({ startBlock, endBlock }: RangePlan) =>
  `${startBlock === undefined ? "" : `startBlock: ${startBlock}, `}${endBlock === undefined ? "" : `endBlock: ${endBlock}, `}`;

const addressConfig = (
  contract: ContractPlan,
  chain: ChainPlan,
  address: ContractPlan["chains"][string]["address"],
) => {
  const tokens = getTokens(chain.id);
  switch (address.kind) {
    case "single":
      return contract.kind === "factory"
        ? `"${getFactory(chain.id)}"`
        : `"${tokens[address.token]}"`;
    case "list":
      return `[${address.tokens.map((i) => `"${tokens[i]}"`).join(", ")}]`;
    case "factory":
      return `factory({ ${address.filterAddress ? `address: "${getFactory(chain.id)}", ` : ""}event: getAbiItem({ abi: factoryAbi, name: "${address.event}" }), parameter: "${address.event === "PoolCreated" ? "pool" : "child"}"${address.startBlock === undefined ? "" : `, startBlock: ${address.startBlock}`} })`;
  }
};

const filterConfig = (
  filter: ContractPlan["chains"][string]["filter"],
  events: string[],
) => {
  const transfer = events.includes("Transfer");
  const approval = events.includes("Approval");
  switch (filter) {
    case "none":
      return "";
    case "from-zero":
      return transfer
        ? `filter: { event: "Transfer", args: { from: zeroAddress } }, `
        : "";
    case "to-list":
      return transfer
        ? `filter: { event: "Transfer", args: { to: ["${EOAS[0]}", "${EOAS[1]}", "${DEAD}"] } }, `
        : "";
    case "multiple": {
      const filters = [
        transfer
          ? `{ event: "Transfer", args: { from: ["${EOAS[2]}", "${EOAS[3]}"] } }`
          : undefined,
        transfer
          ? `{ event: "Transfer", args: { to: ["${EOAS[2]}", "${EOAS[3]}"] } }`
          : undefined,
        approval
          ? `{ event: "Approval", args: { spender: "${EOAS[4]}" } }`
          : undefined,
      ].filter(Boolean);
      return filters.length === 0 ? "" : `filter: [${filters.join(", ")}], `;
    }
  }
};

/**
 * @param rpcUrls The URL of the provider of each chain. Without one, the
 * simulation injects the transports.
 */
export const generateConfig = (
  plan: Plan,
  app: AppPlan,
  databaseUrl: string,
  rpcUrls: { [chainName: string]: string | string[] } = {},
) => {
  const chains = plan.chains.filter((c) => app.chains.includes(c.name));
  const byName = Object.fromEntries(chains.map((c) => [c.name, c]));

  return `// Generated by the simulation for seed ${plan.seed}.
import { createConfig, factory } from "ponder";
import { getAbiItem, zeroAddress } from "viem";
import { factoryAbi, poolAbi, tokenAbi } from "${path.resolve(import.meta.dirname, "shared.ts")}";

export default createConfig({
  ordering: "${app.ordering}",
  database: {
    kind: "postgres",
    connectionString: ${JSON.stringify(databaseUrl)},
    poolConfig: { max: ${plan.database.poolMax} },
  },
  chains: {
${chains
  .map(
    (c) => `    ${c.name}: {
      id: ${c.id},
      rpc: ${JSON.stringify(rpcUrls[c.name] ?? `http://${c.name}.simulation.invalid`)},
      pollingInterval: ${c.pollingInterval},
      reorgWindow: ${c.reorgWindow},
      cacheRpcRequests: ${app.cacheRpcRequests[c.name]},${app.ethGetLogsBlockRange[c.name] === undefined ? "" : `\n      ethGetLogsBlockRange: ${app.ethGetLogsBlockRange[c.name]},`}
    },`,
  )
  .join("\n")}
  },
  contracts: {
${app.contracts
  .map(
    (contract) => `    ${contract.name}: {
      abi: ${ABI_NAMES[contract.kind]},
      chain: {
${Object.entries(contract.chains)
  .map(
    ([name, c]) =>
      `        ${name}: { address: ${addressConfig(contract, byName[name]!, c.address)}, ${range(c)}${filterConfig(c.filter, contract.events)}includeTransactionReceipts: ${c.includeTransactionReceipts}, includeCallTraces: ${c.includeCallTraces} },`,
  )
  .join("\n")}
      },
    },`,
  )
  .join("\n")}
  },
  accounts: {
${app.accounts
  .map(
    (account) => `    ${account.name}: {
      address: "${account.address === "dead" ? DEAD : EOAS[account.address]}",
      chain: {
${Object.entries(account.chains)
  .map(
    ([name, c]) =>
      `        ${name}: { ${range(c)}includeTransactionReceipts: ${c.includeTransactionReceipts} },`,
  )
  .join("\n")}
      },
    },`,
  )
  .join("\n")}
  },
  blocks: {
${app.blocks
  .map(
    (block) => `    ${block.name}: {
      chain: {
${Object.entries(block.chains)
  .map(
    ([name, c]) => `        ${name}: { ${range(c)}interval: ${c.interval} },`,
  )
  .join("\n")}
      },
    },`,
  )
  .join("\n")}
  },
});
`;
};

export const generateSchema = (plan: Plan, app: AppPlan) => {
  const tables = getAppEvents(app).flatMap((event) =>
    event.kind === "setup"
      ? []
      : `export const ${tableExport(event.name)} = onchainTable("${event.table}", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
${event.columns.map((c) => `  ${c.name}: ${c.type},`).join("\n")}
}));`,
  );

  return `// Generated by the simulation for seed ${plan.seed}.
import { index, onchainTable } from "ponder";

/** The latest event, for each chain or for all chains. */
export const simCheckpoint = onchainTable("sim_checkpoint", (t) => ({
  key: t.text().primaryKey(),
  eventId: t.text().notNull(),
  name: t.text().notNull(),
}));

/** Rows that the indexing functions change at random. */
export const simEntity = onchainTable(
  "sim_entity",
  (t) => ({
    key: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    count: t.integer().notNull(),
    lastEventId: t.text().notNull(),
  }),
  (table) => ({ chainIdIndex: index().on(table.chainId) }),
);

/** \`context.client\` results, to check against the chain after the run. */
export const simClient = onchainTable("sim_client", (t) => ({
  id: t.text().primaryKey(),
  chainId: t.integer().notNull(),
  blockNumber: t.bigint().notNull(),
  blockHash: t.hex().notNull(),
  method: t.text().notNull(),
  result: t.json(),
  expected: t.json(),
}));

${tables.join("\n\n")}
`;
};

export const generateIndexing = (plan: Plan, app: AppPlan) => {
  const handlers = getAppEvents(app).map((event) =>
    event.kind === "setup"
      ? `ponder.on("${event.name}", handleSetup("${event.name}"));`
      : `ponder.on(
  "${event.name}",
  handle("${event.name}", schema.${tableExport(event.name)}, (event) => ({
${event.columns.map((c) => `    ${c.name}: ${c.value},`).join("\n")}
  })),
);`,
  );

  return `// Generated by the simulation for seed ${plan.seed}.
import { ponder } from "ponder:registry";
import * as schema from "ponder:schema";
import { createHandler, toJson } from "${path.resolve(import.meta.dirname, "app-runtime.ts")}";

const { handle, handleSetup } = createHandler({
  seed: ${JSON.stringify(plan.seed)},
  app: ${JSON.stringify({ ordering: app.ordering, indexing: app.indexing })},
  tables: {
    simCheckpoint: schema.simCheckpoint,
    simEntity: schema.simEntity,
    simClient: schema.simClient,
  },
});

${handlers.join("\n\n")}
`;
};

const API = `import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, graphql } from "ponder";

const app = new Hono();

app.use("/sql/*", client({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
`;

/** Write the files of `app` to `dir`. */
export const writeApp = ({
  plan,
  app,
  dir,
  databaseUrl,
  rpcUrls,
}: {
  plan: Plan;
  app: AppPlan;
  dir: string;
  databaseUrl: string;
  rpcUrls?: { [chainName: string]: string | string[] };
}) => {
  fs.mkdirSync(path.join(dir, "src", "api"), { recursive: true });
  const write = (file: string, content: string) => {
    const target = path.join(dir, file);
    // Note: Unchanged files keep their modification time, for Vite.
    if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === content)
      return;
    fs.writeFileSync(target, content);
  };
  write("ponder.config.ts", generateConfig(plan, app, databaseUrl, rpcUrls));
  write("ponder.schema.ts", generateSchema(plan, app));
  write("src/index.ts", generateIndexing(plan, app));
  write("src/api/index.ts", API);
};
