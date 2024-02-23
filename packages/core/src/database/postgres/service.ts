import type { Common } from "@/Ponder.js";
import type { FunctionIds, TableIds } from "@/build/static/ids.js";
import type { TableAccess } from "@/build/static/parseAst.js";
import { revertTable } from "@/indexing-store/utils/revert.js";
import type { Schema } from "@/schema/types.js";
import { isEnumColumn, isManyColumn, isOneColumn } from "@/schema/utils.js";
import {
  checkpointMax,
  decodeCheckpoint,
  encodeCheckpoint,
} from "@/utils/checkpoint.js";
import { dedupe } from "@/utils/dedupe.js";
import { createPool } from "@/utils/pg.js";
import {
  CreateTableBuilder,
  Kysely,
  Migrator,
  PostgresDialect,
  WithSchemaPlugin,
  sql,
} from "kysely";
import type { Pool, PoolConfig } from "pg";
import type { BaseDatabaseService, Metadata } from "../service.js";
import { type PonderCoreSchema, migrationProvider } from "./migrations.js";

export class PostgresDatabaseService implements BaseDatabaseService {
  kind = "postgres" as const;

  db: Kysely<PonderCoreSchema>;
  private pool: Pool;

  private instanceId: string;
  private publicSchemaName: string;
  private cacheSchemaName: string;
  private instanceSchemaName: string;
  currentIndexingSchemaName: string = null!;

  schema?: Schema;
  tableIds?: TableIds;
  metadata: Metadata[] = undefined!;

  constructor({
    common,
    poolConfig,
  }: {
    common: Common;
    poolConfig: PoolConfig;
  }) {
    this.instanceId = common.instanceId;
    this.publicSchemaName = "public";
    this.cacheSchemaName = "ponder_core_cache";
    this.instanceSchemaName = `ponder_core_${common.instanceId}`;

    this.pool = createPool(poolConfig);
    this.db = new Kysely<PonderCoreSchema>({
      dialect: new PostgresDialect({ pool: this.pool }),
      log(event) {
        if (event.level === "error") console.log(event);
        if (event.level === "query") {
          common.metrics.ponder_postgres_query_count?.inc({ kind: "indexing" });
        }
      },
    });
  }

  async setup() {
    // 1) Create the core cache schema if it doesn't exist.
    await this.db.schema
      .createSchema(this.cacheSchemaName)
      .ifNotExists()
      .execute();

    // 2) Run core cache schema migrations.
    const migrator = new Migrator({
      db: this.db.withPlugin(new WithSchemaPlugin(this.cacheSchemaName)),
      provider: migrationProvider,
      migrationTableSchema: this.cacheSchemaName,
    });
    const result = await migrator.migrateToLatest();
    if (result.error) throw result.error;

    // 3) Create instance-specific schema and role.
    await this.db.transaction().execute(async (tx) => {
      await tx.schema
        .createSchema(this.instanceSchemaName)
        .ifNotExists()
        .execute();

      await tx.executeQuery(
        sql`CREATE ROLE ${sql.raw(this.instanceSchemaName)}`.compile(tx),
      );
      await tx.executeQuery(
        sql`GRANT USAGE ON SCHEMA ${sql.raw(this.cacheSchemaName)}, ${sql.raw(
          this.instanceSchemaName,
        )} TO ${sql.raw(this.instanceSchemaName)}`.compile(tx),
      );
      await tx.executeQuery(
        sql`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${sql.raw(
          this.cacheSchemaName,
        )}, ${sql.raw(this.instanceSchemaName)} TO ${sql.raw(
          this.instanceSchemaName,
        )}`.compile(tx),
      );
    });
  }

  async getIndexingDatabase() {
    return { pool: this.pool, schemaName: this.instanceSchemaName };
  }

  async getSyncDatabase() {
    const pluginSchemaName = "ponder_sync";
    await this.db.schema.createSchema(pluginSchemaName).ifNotExists().execute();
    return { pool: this.pool, schemaName: pluginSchemaName };
  }

  async kill() {
    // TODO(kyle): Flush here?

    // Delete instance-specific role and schema.
    await this.db.transaction().execute(async (tx) => {
      await tx.executeQuery(
        sql`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${sql.raw(
          this.cacheSchemaName,
        )}, ${sql.raw(this.instanceSchemaName)} FROM ${sql.raw(
          this.instanceSchemaName,
        )}`.compile(tx),
      );
      await tx.executeQuery(
        sql`REVOKE USAGE ON SCHEMA ${sql.raw(this.cacheSchemaName)}, ${sql.raw(
          this.instanceSchemaName,
        )} FROM ${sql.raw(this.instanceSchemaName)}`.compile(tx),
      );
      await tx.executeQuery(
        sql`DROP ROLE ${sql.raw(this.instanceSchemaName)}`.compile(tx),
      );
      await tx.schema
        .dropSchema(this.instanceSchemaName)
        .ifExists()
        .cascade()
        .execute();
    });

    try {
      await this.db.destroy();
    } catch (e) {
      // TODO: drop table
      const error = e as Error;
      if (error.message !== "Called end on pool more than once") {
        throw error;
      }
    }
  }

  async reset({
    schema,
    tableIds,
    functionIds,
    tableAccess,
  }: {
    schema: Schema;
    tableIds: TableIds;
    functionIds: FunctionIds;
    tableAccess: TableAccess;
  }) {
    if (schema) this.schema = schema;
    if (tableIds) this.tableIds = tableIds;

    const metadata = await this.db.transaction().execute(async (tx) => {
      // 1) Edge case: If there are no rows found in the lock table, acquire the lock.
      const latestLock = await tx
        .withSchema(this.cacheSchemaName)
        .selectFrom("lock")
        .selectAll()
        .executeTakeFirst();
      if (latestLock === undefined) {
        await tx
          .withSchema(this.cacheSchemaName)
          .insertInto("lock")
          .values({
            id: "instance_lock",
            instance_id: this.instanceId,
            schema: JSON.stringify(this.schema),
          })
          .execute();

        this.currentIndexingSchemaName = this.publicSchemaName;
      } else {
        this.currentIndexingSchemaName = this.instanceSchemaName;
      }

      // 2) Create tables in the current indexing schema, copying cached data if available.
      const tables = Object.entries(this.schema!.tables);
      await Promise.all(
        tables.map(async ([tableName, columns]) => {
          const tableId = this.tableIds![tableName];
          const versionedTableName = `${tableName}_versioned`;

          // 1) Create a table in the instance schema.
          await tx.schema
            .withSchema(this.currentIndexingSchemaName)
            .createTable(versionedTableName)
            .$call((builder) => this.buildColumns(builder, tableName, columns))
            .execute();

          // 2) Create a table in the cache schema if it doesn't already exist.
          await tx.schema
            .withSchema(this.cacheSchemaName)
            .createTable(tableId)
            .$call((builder) => this.buildColumns(builder, tableName, columns))
            .ifNotExists()
            .execute();

          // 3) Copy data from the cache table to the new table.
          await tx.executeQuery(
            sql`INSERT INTO ${sql.raw(
              `"${this.currentIndexingSchemaName}"."${versionedTableName}"`,
            )} SELECT * FROM ${sql.raw(
              `"${this.cacheSchemaName}"."${tableId}"`,
            )}`.compile(tx),
          );
        }),
      );

      const functionIds_ = Object.values(functionIds);
      if (functionIds_.length === 0) return [];

      const metadata = await tx
        .withSchema(this.cacheSchemaName)
        .selectFrom("metadata")
        .selectAll()
        .where("functionId", "in", functionIds_)
        .execute();

      return metadata;
    });

    this.metadata = metadata.map((m) => ({
      functionId: m.functionId,
      fromCheckpoint: m.fromCheckpoint
        ? decodeCheckpoint(m.fromCheckpoint)
        : null,
      toCheckpoint: decodeCheckpoint(m.toCheckpoint),
      eventCount: m.eventCount,
    }));

    /**
     * It's possible for the cache tables to contain more data than the metadata indicates.
     * To avoid copying unfinalized data left over from a previous instance, we must revert
     * the instance tables to the checkpoint saved in the metadata after copying from the cache.
     * In other words, metadata checkpoints are always <= actual rows in the corresponding table.
     */
    for (const tableName of Object.keys(schema.tables)) {
      const indexingFunctionKeys = tableAccess
        .filter((t) => t.access === "write" && t.table === tableName)
        .map((t) => t.indexingFunctionKey);

      const tableMetadata = dedupe(indexingFunctionKeys).map((key) =>
        this.metadata.find((m) => m.functionId === functionIds[key]),
      );

      if (tableMetadata.some((m) => m === undefined)) continue;

      const checkpoints = tableMetadata.map((m) => m!.toCheckpoint);

      if (checkpoints.length === 0) continue;

      const tableCheckpoint = checkpointMax(...checkpoints);

      await revertTable(
        this.db.withSchema(this.currentIndexingSchemaName),
        tableName,
        tableCheckpoint,
      );
    }
  }

  async flush(metadata: Metadata[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      const tables = Object.entries(this.schema!.tables);

      await Promise.all(
        tables.map(async ([tableName, columns]) => {
          const tableId = this.tableIds![tableName];
          const versionedTableName = `${tableName}_versioned`;

          // 1) Drop existing cache table.
          await tx.schema
            .withSchema(this.cacheSchemaName)
            .dropTable(tableId)
            .ifExists()
            .execute();

          // 2) Create new empty cache table.
          await tx.schema
            .withSchema(this.cacheSchemaName)
            .createTable(tableId)
            .$call((builder) => this.buildColumns(builder, tableName, columns))
            .execute();

          // 3) Copy data from current indexing table to new cache table.
          await tx.executeQuery(
            sql`INSERT INTO ${sql.raw(
              `"${this.cacheSchemaName}"."${tableId}"`,
            )} SELECT * FROM ${sql.raw(
              `"${this.currentIndexingSchemaName}"."${versionedTableName}"`,
            )}`.compile(tx),
          );
        }),
      );

      const newMetadata = metadata.map((m) => ({
        functionId: m.functionId,
        fromCheckpoint: m.fromCheckpoint
          ? encodeCheckpoint(m.fromCheckpoint)
          : null,
        toCheckpoint: encodeCheckpoint(m.toCheckpoint),
        eventCount: m.eventCount,
      }));

      await Promise.all(
        newMetadata.map(async (metadata) => {
          await tx
            .withSchema(this.cacheSchemaName)
            .insertInto("metadata")
            .values(metadata)
            .onConflict((oc) => oc.column("functionId").doUpdateSet(metadata))
            .execute();
        }),
      );
    });
  }

  async publish() {
    await this.db.transaction().execute(async (tx) => {
      const latestLock = await tx
        .withSchema(this.cacheSchemaName)
        .selectFrom("lock")
        .selectAll()
        .executeTakeFirst();

      // If the latest lock is undefined, it's an invariant violation.
      if (latestLock === undefined) {
        throw new Error(
          "Invariant violation: Attempted to publish, but the lock table is empty.",
        );
      }

      // If the latest lock is this instance, we already published and can return early.
      if (latestLock.instance_id === this.instanceId) return;

      const oldSchemaName = `ponder_core_${latestLock.instance_id}`;
      const oldTableNames = Object.keys(
        (JSON.parse(latestLock.schema) as Schema).tables,
      );

      // The database can be in a few states:
      // 1) Previous instance is not running, shut down gracefully
      // 2) Previous instance is not running, shut down abruptly
      // 3) Previous instance is still running, lock has not expired
      // 4) Previous instance is still running, lock has expired (????)

      // If the old instance schema still exists, move tables from public to it.
      // Otherwise, drop any old tables from public.
      const { rows: schemaExistsRows } = await tx.executeQuery<{
        exists: boolean;
      }>(
        sql`SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = '${sql.raw(
          oldSchemaName,
        )}')`.compile(tx),
      );
      const oldInstanceSchemaExists = schemaExistsRows[0]?.exists ?? false;
      if (oldInstanceSchemaExists) {
        await Promise.all(
          oldTableNames.map(async (oldTableName) => {
            const oldVersionedTableName = `${oldTableName}_versioned`;
            await tx.schema
              .withSchema(this.publicSchemaName)
              .alterTable(oldVersionedTableName)
              .setSchema(oldSchemaName)
              .execute();
          }),
        );
      } else {
        await Promise.all(
          oldTableNames.map(async (oldTableName) => {
            const oldVersionedTableName = `${oldTableName}_versioned`;
            await tx.schema
              .withSchema(this.publicSchemaName)
              .dropTable(oldVersionedTableName)
              .ifExists()
              .cascade()
              .execute();
          }),
        );
      }

      // If the old instance role still exists, revoke public permissions.
      const { rows: roleExistsRows } = await tx.executeQuery<{
        exists: boolean;
      }>(
        sql`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = '${sql.raw(
          oldSchemaName,
        )}')`.compile(tx),
      );
      const oldInstanceRoleExists = roleExistsRows[0]?.exists ?? false;

      // 2) Revoke public schema access privileges for the old user.
      if (oldInstanceRoleExists) {
        await tx.executeQuery(
          sql`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${sql.raw(
            this.publicSchemaName,
          )} FROM ${sql.raw(oldSchemaName)}`.compile(tx),
        );
        await tx.executeQuery(
          sql`REVOKE USAGE ON SCHEMA ${sql.raw(
            this.publicSchemaName,
          )} FROM ${sql.raw(oldSchemaName)}`.compile(tx),
        );
      }

      // Move the new instance tables into the public schema.
      const tableNames = Object.keys(this.schema!.tables);
      await Promise.all(
        tableNames.map(async (tableName) => {
          const versionedTableName = `${tableName}_versioned`;
          await tx.schema
            .withSchema(this.instanceSchemaName)
            .alterTable(versionedTableName)
            .setSchema(this.publicSchemaName)
            .execute();
        }),
      );

      // Update the lock.
      await tx
        .withSchema(this.cacheSchemaName)
        .updateTable("lock")
        .where("id", "=", "instance_lock")
        .set({
          instance_id: this.instanceId,
          schema: JSON.stringify(this.schema!),
        })
        .execute();

      this.currentIndexingSchemaName = this.publicSchemaName;
    });
  }

  buildColumns(
    builder: CreateTableBuilder<string>,
    tableId: string,
    columns: Schema["tables"][string],
  ) {
    Object.entries(columns).forEach(([columnName, column]) => {
      if (isOneColumn(column)) return;
      if (isManyColumn(column)) return;
      if (isEnumColumn(column)) {
        // Handle enum types
        builder = builder.addColumn(columnName, "text", (col) => {
          if (!column.optional) col = col.notNull();
          if (!column.list) {
            col = col.check(
              sql`${sql.ref(columnName)} in (${sql.join(
                this.schema!.enums[column.type].map((v) => sql.lit(v)),
              )})`,
            );
          }
          return col;
        });
      } else if (column.list) {
        // Handle scalar list columns
        builder = builder.addColumn(columnName, "text", (col) => {
          if (!column.optional) col = col.notNull();
          return col;
        });
      } else {
        // Non-list base columns
        builder = builder.addColumn(
          columnName,
          scalarToSqlType[column.type],
          (col) => {
            if (!column.optional) col = col.notNull();
            return col;
          },
        );
      }
    });

    builder = builder.addColumn(
      "effectiveFromCheckpoint",
      "varchar(58)",
      (col) => col.notNull(),
    );
    builder = builder.addColumn("effectiveToCheckpoint", "varchar(58)", (col) =>
      col.notNull(),
    );
    builder = builder.addPrimaryKeyConstraint(
      `${tableId}_id_checkpoint_unique`,
      ["id", "effectiveToCheckpoint"] as never[],
    );

    return builder;
  }
}

const scalarToSqlType = {
  boolean: "integer",
  int: "integer",
  float: "text",
  string: "text",
  bigint: "numeric(78, 0)",
  hex: "bytea",
} as const;
