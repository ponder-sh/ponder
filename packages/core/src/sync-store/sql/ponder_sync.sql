CREATE SCHEMA "ponder_sync";
--> statement-breakpoint
CREATE TABLE "ponder_sync"."blocks" (
	"chain_id" bigint NOT NULL,
	"number" bigint NOT NULL,
	"timestamp" bigint NOT NULL,
	"hash" varchar(66) NOT NULL,
	"parent_hash" varchar(66) NOT NULL,
	"logs_bloom" varchar(514) NOT NULL,
	"miner" varchar(42) NOT NULL,
	"gas_used" numeric(78,0) NOT NULL,
	"gas_limit" numeric(78,0) NOT NULL,
	"base_fee_per_gas" numeric(78,0),
	"nonce" varchar(18),
	"mix_hash" varchar(66),
	"state_root" varchar(66) NOT NULL,
	"receipts_root" varchar(66) NOT NULL,
	"transactions_root" varchar(66) NOT NULL,
	"sha3_uncles" varchar(66),
	"size" numeric(78,0) NOT NULL,
	"difficulty" numeric(78,0) NOT NULL,
	"total_difficulty" numeric(78,0),
	"extra_data" text NOT NULL,
	CONSTRAINT "blocks_pkey" PRIMARY KEY("chain_id","number")
);
--> statement-breakpoint
CREATE TABLE "ponder_sync"."factories" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ponder_sync"."factories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"factory" jsonb NOT NULL,
	CONSTRAINT "factories_factory_key" UNIQUE("factory")
);
--> statement-breakpoint
CREATE TABLE "ponder_sync"."factory_addresses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ponder_sync"."factory_addresses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"factory_id" integer NOT NULL,
	"chain_id" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"address" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ponder_sync"."intervals" (
	"fragment_id" text PRIMARY KEY NOT NULL,
	"chain_id" bigint NOT NULL,
	"blocks" "nummultirange" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ponder_sync"."logs" (
	"chain_id" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"log_index" integer NOT NULL,
	"transaction_index" integer NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"address" varchar(42) NOT NULL,
	"topic0" varchar(66),
	"topic1" varchar(66),
	"topic2" varchar(66),
	"topic3" varchar(66),
	"data" text NOT NULL,
	CONSTRAINT "logs_pkey" PRIMARY KEY("chain_id","block_number","log_index")
);
--> statement-breakpoint
CREATE TABLE "ponder_sync"."rpc_request_results" (
	"request_hash" text NOT NULL,
	"chain_id" bigint NOT NULL,
	"block_number" bigint,
	"result" text NOT NULL,
	CONSTRAINT "rpc_request_results_pkey" PRIMARY KEY("chain_id","request_hash")
);
--> statement-breakpoint
CREATE TABLE "ponder_sync"."traces" (
	"chain_id" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"transaction_index" integer NOT NULL,
	"trace_index" integer NOT NULL,
	"from" varchar(42) NOT NULL,
	"to" varchar(42),
	"input" text NOT NULL,
	"output" text,
	"value" numeric(78,0),
	"type" text NOT NULL,
	"gas" numeric(78,0) NOT NULL,
	"gas_used" numeric(78,0) NOT NULL,
	"error" text,
	"revert_reason" text,
	"subcalls" integer NOT NULL,
	CONSTRAINT "traces_pkey" PRIMARY KEY("chain_id","block_number","transaction_index","trace_index")
);
--> statement-breakpoint
CREATE TABLE "ponder_sync"."transaction_receipts" (
	"chain_id" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"transaction_index" integer NOT NULL,
	"transaction_hash" varchar(66) NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"from" varchar(42) NOT NULL,
	"to" varchar(42),
	"contract_address" varchar(42),
	"logs_bloom" varchar(514) NOT NULL,
	"gas_used" numeric(78,0) NOT NULL,
	"cumulative_gas_used" numeric(78,0) NOT NULL,
	"effective_gas_price" numeric(78,0) NOT NULL,
	"status" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "transaction_receipts_pkey" PRIMARY KEY("chain_id","block_number","transaction_index")
);
--> statement-breakpoint
CREATE TABLE "ponder_sync"."transactions" (
	"chain_id" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"transaction_index" integer NOT NULL,
	"hash" varchar(66) NOT NULL,
	"block_hash" varchar(66) NOT NULL,
	"from" varchar(42) NOT NULL,
	"to" varchar(42),
	"input" text NOT NULL,
	"value" numeric(78,0) NOT NULL,
	"nonce" integer NOT NULL,
	"r" varchar(66),
	"s" varchar(66),
	"v" numeric(78,0),
	"type" text NOT NULL,
	"gas" numeric(78,0) NOT NULL,
	"gas_price" numeric(78,0),
	"max_fee_per_gas" numeric(78,0),
	"max_priority_fee_per_gas" numeric(78,0),
	"access_list" text,
	CONSTRAINT "transactions_pkey" PRIMARY KEY("chain_id","block_number","transaction_index")
);
--> statement-breakpoint
CREATE INDEX "factories_factory_idx" ON "ponder_sync"."factories" USING btree ("factory");--> statement-breakpoint
CREATE INDEX "factory_addresses_factory_id_index" ON "ponder_sync"."factory_addresses" USING btree ("factory_id");--> statement-breakpoint
CREATE INDEX "rpc_request_results_chain_id_block_number_index" ON "ponder_sync"."rpc_request_results" USING btree ("chain_id","block_number");
--> statement-breakpoint
-- Preserve compatibility with releases that use Kysely. Its migrator requires
-- the complete history, even though this schema was created directly.
CREATE TABLE "ponder_sync"."kysely_migration" (
	"name" varchar(255) PRIMARY KEY NOT NULL,
	"timestamp" varchar(255) NOT NULL
);
--> statement-breakpoint
INSERT INTO "ponder_sync"."kysely_migration" ("name", "timestamp")
SELECT "name", to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (VALUES
	('2023_05_15_0_initial'),
	('2023_06_20_0_indices'),
	('2023_07_18_0_better_indices'),
	('2023_07_24_0_drop_finalized'),
	('2023_09_19_0_new_sync_design'),
	('2023_11_06_0_new_rpc_cache_design'),
	('2024_01_30_0_change_chain_id_type'),
	('2024_02_1_0_nullable_block_columns'),
	('2024_03_00_0_log_transaction_hash_index'),
	('2024_03_13_0_nullable_block_columns_sha3uncles'),
	('2024_03_14_0_nullable_transaction_rsv'),
	('2024_03_20_0_checkpoint_in_logs_table'),
	('2024_04_04_0_log_events_indexes'),
	('2024_04_14_0_nullable_block_total_difficulty'),
	('2024_04_14_1_add_checkpoint_column_to_logs_table'),
	('2024_04_14_2_set_checkpoint_in_logs_table'),
	('2024_04_14_3_index_on_logs_checkpoint'),
	('2024_04_22_0_transaction_receipts'),
	('2024_04_23_0_block_filters'),
	('2024_05_07_0_trace_filters'),
	('2024_11_04_0_request_cache'),
	('2024_11_09_0_adjacent_interval'),
	('2024_11_12_0_debug'),
	('2024_12_02_0_request_cache'),
	('2025_02_19_0_primary_key'),
	('2025_02_26_0_factories'),
	('2025_02_26_1_rpc_request_results')
) AS "migrations" ("name");
