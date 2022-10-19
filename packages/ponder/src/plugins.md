# Plugins

The `@ponder/core` package is responsible for:

1. Interpreting `ponder.config.js`
2. Fetching and caching required blockdata event data
3. Processing blockchain event data using the handler functions defined in `handlers/`
4. Calling plugins based on the plugin hooks

Plugin event hooks

1. onSetup
   1. Runs once on server start (both `ponder dev` and `ponder start`)
   2. Receives (config: PonderConfig)
   3. Returns (handlerContext: {...}, watchFiles: string[])
2. onBackfillComplete
   1. Runs after the backfill completes
   2. Receives (isHotReload: boolean, config: PonderConfig)
3. onBackfillHandlersComplete
   1. Runs after the backfill log processing completes
4. onLiveBlockHandlersComplete
   1. Runs every time a live block gets processed

Ponder runtime

1. Read `ponder.config.js`
2. Initialize internal mutable state object?
3. Build db, networks & sources
4. Run plugin registration functions, store results in mutable state
5. Call onSetup plugin callbacks
6. ?? Register file watching
7. Kick off backfill
8. Call onBackfillComplete plugin callbacks
9. Kick off log processing
10. Call onBackfillHandlersComplete plugin callbacks
