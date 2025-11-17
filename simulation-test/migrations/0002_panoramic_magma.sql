DROP TABLE "rpc_cache"."eth_getBlockReceipts";
--> statement-breakpoint
CREATE TABLE "rpc_cache"."eth_getBlockReceipts" (
	"chain_id" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "eth_getBlockReceipts_chain_id_block_hash_pk" PRIMARY KEY("chain_id","block_hash")
);