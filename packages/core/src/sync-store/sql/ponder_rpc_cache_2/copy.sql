INSERT INTO "ponder_rpc_cache_2"."blocks" ("chain_id", "number", "timestamp", "hash", "parent_hash", "logs_bloom", "miner", "gas_used", "gas_limit", "base_fee_per_gas", "nonce", "mix_hash", "state_root", "receipts_root", "transactions_root", "sha3_uncles", "size", "difficulty", "total_difficulty", "extra_data") SELECT "chain_id", "number", "timestamp", "hash", "parent_hash", "logs_bloom", "miner", "gas_used", "gas_limit", "base_fee_per_gas", "nonce", "mix_hash", "state_root", "receipts_root", "transactions_root", "sha3_uncles", "size", "difficulty", "total_difficulty", "extra_data" FROM "ponder_rpc_cache_1"."blocks";
--> statement-breakpoint
INSERT INTO "ponder_rpc_cache_2"."factories" ("id", "fragment_id") OVERRIDING SYSTEM VALUE SELECT "id", "fragment_id" FROM "ponder_rpc_cache_1"."factories";
--> statement-breakpoint
INSERT INTO "ponder_rpc_cache_2"."factory_addresses" ("factory_id", "chain_id", "block_number", "address") SELECT "factory_id", "chain_id", "block_number", "address" FROM "ponder_rpc_cache_1"."factory_addresses";
--> statement-breakpoint
INSERT INTO "ponder_rpc_cache_2"."intervals" ("fragment_id", "chain_id", "blocks") SELECT "fragment_id", "chain_id", "blocks" FROM "ponder_rpc_cache_1"."intervals";
--> statement-breakpoint
INSERT INTO "ponder_rpc_cache_2"."logs" ("chain_id", "block_number", "log_index", "transaction_index", "block_hash", "transaction_hash", "address", "topic0", "topic1", "topic2", "topic3", "data") SELECT "chain_id", "block_number", "log_index", "transaction_index", "block_hash", "transaction_hash", "address", "topic0", "topic1", "topic2", "topic3", "data" FROM "ponder_rpc_cache_1"."logs";
--> statement-breakpoint
INSERT INTO "ponder_rpc_cache_2"."rpc_request_results" ("request_hash", "chain_id", "block_number", "result") SELECT "request_hash", "chain_id", "block_number", "result" FROM "ponder_rpc_cache_1"."rpc_request_results";
--> statement-breakpoint
INSERT INTO "ponder_rpc_cache_2"."traces" ("chain_id", "block_number", "transaction_index", "trace_address", "from", "to", "input", "output", "value", "type", "gas", "gas_used") SELECT "chain_id", "block_number", "transaction_index", "trace_address", "from", "to", "input", "output", "value", "type", "gas", "gas_used" FROM "ponder_rpc_cache_1"."traces";
--> statement-breakpoint
INSERT INTO "ponder_rpc_cache_2"."transaction_receipts" ("chain_id", "block_number", "transaction_index", "transaction_hash", "block_hash", "from", "to", "contract_address", "logs_bloom", "gas_used", "cumulative_gas_used", "effective_gas_price", "status", "type") SELECT "chain_id", "block_number", "transaction_index", "transaction_hash", "block_hash", "from", "to", "contract_address", "logs_bloom", "gas_used", "cumulative_gas_used", "effective_gas_price", "status", "type" FROM "ponder_rpc_cache_1"."transaction_receipts";
--> statement-breakpoint
INSERT INTO "ponder_rpc_cache_2"."transactions" ("chain_id", "block_number", "transaction_index", "hash", "block_hash", "from", "to", "input", "value", "nonce", "r", "s", "v", "type", "gas", "gas_price", "max_fee_per_gas", "max_priority_fee_per_gas", "access_list") SELECT "chain_id", "block_number", "transaction_index", "hash", "block_hash", "from", "to", "input", "value", "nonce", "r", "s", "v", "type", "gas", "gas_price", "max_fee_per_gas", "max_priority_fee_per_gas", "access_list" FROM "ponder_rpc_cache_1"."transactions";
--> statement-breakpoint
SELECT setval('"ponder_rpc_cache_2"."factories_id_seq"', (SELECT last_value FROM "ponder_rpc_cache_1"."factories_id_seq"), (SELECT is_called FROM "ponder_rpc_cache_1"."factories_id_seq"));
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."blocks";
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."factories";
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."factory_addresses";
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."intervals";
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."logs";
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."rpc_request_results";
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."traces";
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."transaction_receipts";
--> statement-breakpoint
ANALYZE "ponder_rpc_cache_2"."transactions";
