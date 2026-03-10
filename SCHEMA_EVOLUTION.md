# Schema Evolution with Resume from Checkpoint

## What Changed

The Ponder migration logic in `packages/core/src/database/index.ts` was modified to allow
reusing the same database schema across deployments with different code, instead of requiring
a new schema name every time the build changes.

### Previous Behavior

When any source file changed (config, schema definition, or indexing functions), Ponder computed
a new `buildId` (SHA-256 hash of all file contents). If the target database schema already
contained tables from a previous deployment with a different `buildId`, Ponder threw:

```
Schema "X" was previously used by a different Ponder app.
Drop the schema first, or use a different schema.
```

This forced users to either use a new schema name per deployment or manually drop the old one.

### New Behavior

When a `buildId` mismatch is detected on a schema that was previously used by a `start`
(production) deployment:

1. **New database objects are created** (tables, reorg tables, enums, views) using
   `skipExisting: true` -- objects that already exist are silently skipped.
2. **Crash recovery runs** -- uncommitted changes in reorg tables are reverted to the last
   safe checkpoint.
3. **Indexing resumes from the last checkpoint** -- no data is lost, no full re-index.

## Files Modified

| File | Change |
|------|--------|
| `packages/core/src/database/index.ts` | Added `skipExisting` param to `createTables`, `createViews`, `createEnums`; replaced build_id mismatch error with create-if-needed + crash recovery; moved lock check before build_id handling |
| `packages/core/src/database/index.test.ts` | Updated test `"migrate() throws with schema used"` → `"migrate() resumes with different build_id"` to expect success instead of error |

## Deployment Workflows

### Adding a new event handler + table

1. Deploy v1 with `ponder start` -- tables created, indexing runs normally.
2. Add new handler and table to `ponder.schema.ts` and indexing functions.
3. Optionally run a migration script to CREATE TABLE in the database (if you don't,
   Ponder will create it automatically on the next deploy).
4. Deploy v2 -- Ponder detects build_id changed, creates the new table + its reorg table
   (skips existing ones), resumes from last checkpoint.

### Adding a column to an existing table

1. Deploy v1 with `ponder start` -- tables created, indexing runs normally.
2. Add the new column to `ponder.schema.ts`.
3. Run `ALTER TABLE ... ADD COLUMN ...` against the database to add the column.
4. Deploy v2 -- Ponder detects build_id changed, tries CREATE TABLE for each table
   (all fail with "already exists" and are skipped), resumes from last checkpoint.
5. New events populate the new column going forward.

## What Is Preserved

- **Existing table data**: Tables are never dropped or truncated on build_id change.
- **Reorg protection**: Reorg tables and triggers continue working for both existing and new
  tables. Crash recovery reverts uncommitted data in reorg tables on startup.
- **RPC cache**: The `ponder_sync` schema is completely separate and always reused.
- **Checkpoints**: Per-chain checkpoints are preserved. Indexing resumes from where it left off.

## Limitations

### New handlers on existing chains miss historical events

If chain A is already at block 1000 and you add a new event handler for chain A, the new
handler only receives events from block 1000 onward. Events from blocks 0-999 are not
replayed for the new handler. To backfill, you would need to reset the checkpoint manually
or use a separate process.

### Schema mismatches cause runtime errors, not migration errors

If you add a column to `ponder.schema.ts` but do NOT run `ALTER TABLE` on the database,
Ponder will start successfully but fail at runtime when it tries to INSERT with the new
column. This is by design -- the user is responsible for keeping the database schema in sync
with `ponder.schema.ts`.

### Removing a chain from config is not supported

If you remove a chain from `ponder.config.ts` that has existing checkpoint data, the
finalized block validation will fail because the removed chain's checkpoint still exists
but the chain is no longer in the config. To handle this, manually delete the chain's row
from `_ponder_checkpoint` before deploying.

### Dev mode behavior

- **dev after dev** (unchanged): Drops everything and recreates from scratch.
- **dev after start** (changed): Previously errored. Now creates new objects and resumes
  from checkpoint on the first run. On subsequent dev runs, the standard dev behavior
  (drop and recreate) applies because `is_dev` is set to 1.
- **start after dev** (unchanged): The `is_dev === 1` flag from the previous dev run
  triggers a full drop and recreate.

### Metadata update timing

When the previous run had no checkpoints (never completed setup events) and the build_id
changed, the `_ponder_meta` table is not updated with the new build_id on the current run.
This is benign -- the next run will detect the mismatch again, skip all existing objects,
and proceed. Once checkpoints are saved, metadata is updated normally.

## Unchanged Behavior

- **Fresh deployments** (no previous `_ponder_meta`): All objects created from scratch.
- **Same build_id restarts**: Standard crash recovery, no object creation.
- **Version mismatch**: Still errors if the Ponder version changed between deployments.
- **Lock contention**: Still waits and retries if another instance holds the lock.
- **`PONDER_EXPERIMENTAL_DB=platform`**: Still bypasses the build_id check entirely.
- **`ponder prune`**: Still works for cleaning up inactive schemas.
- **`ponder serve`**: Still works for read-only API serving.
