CREATE TABLE "rpc_cache"."eth_call" (
	"chain_id" bigint NOT NULL,
	"request" jsonb NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "eth_call_chain_id_request_pk" PRIMARY KEY("chain_id","request")
);
