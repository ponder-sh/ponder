CREATE SCHEMA "rpc_cache";
--> statement-breakpoint
CREATE TABLE "rpc_cache"."eth_getBlockReceipts" (
	"chain_id" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "eth_getBlockReceipts_chain_id_block_number_pk" PRIMARY KEY("chain_id","block_number")
);
--> statement-breakpoint
CREATE TABLE "rpc_cache"."eth_getBlock" (
	"chain_id" bigint NOT NULL,
	"number" bigint NOT NULL,
	"hash" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "eth_getBlock_chain_id_number_pk" PRIMARY KEY("chain_id","number")
);
--> statement-breakpoint
CREATE TABLE "rpc_cache"."eth_getLogs" (
	"chain_id" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "eth_getLogs_chain_id_block_number_pk" PRIMARY KEY("chain_id","block_number")
);
--> statement-breakpoint
CREATE TABLE "rpc_cache"."debug_traceBlock" (
	"chain_id" bigint NOT NULL,
	"number" bigint NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "debug_traceBlock_chain_id_number_pk" PRIMARY KEY("chain_id","number")
);
--> statement-breakpoint
CREATE TABLE "rpc_cache"."eth_getTransactionReceipt" (
	"chain_id" bigint NOT NULL,
	"transaction_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "eth_getTransactionReceipt_chain_id_transaction_hash_pk" PRIMARY KEY("chain_id","transaction_hash")
);
