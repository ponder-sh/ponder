CREATE SCHEMA "expected";
--> statement-breakpoint
CREATE TABLE "expected"."blocks" (
	"name" text NOT NULL,
	"id" varchar(75) NOT NULL,
	"chain_id" bigint NOT NULL,
	"number" bigint NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "blocks_name_id_pk" PRIMARY KEY("name","id")
);
--> statement-breakpoint
CREATE TABLE "expected"."checkpoints" (
	"chain_id" bigint PRIMARY KEY NOT NULL,
	"id" varchar(75) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expected"."logs" (
	"name" text NOT NULL,
	"id" varchar(75) NOT NULL,
	"chain_id" bigint NOT NULL,
	"log_index" bigint NOT NULL,
	CONSTRAINT "logs_name_id_pk" PRIMARY KEY("name","id")
);
--> statement-breakpoint
CREATE TABLE "expected"."traces" (
	"name" text NOT NULL,
	"id" varchar(75) NOT NULL,
	"chain_id" bigint NOT NULL,
	"trace_index" bigint NOT NULL,
	CONSTRAINT "traces_name_id_pk" PRIMARY KEY("name","id")
);
--> statement-breakpoint
CREATE TABLE "expected"."transaction_receipts" (
	"name" text NOT NULL,
	"id" varchar(75) NOT NULL,
	"chain_id" bigint NOT NULL,
	"transaction_index" bigint NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "transaction_receipts_name_id_pk" PRIMARY KEY("name","id")
);
--> statement-breakpoint
CREATE TABLE "expected"."transactions" (
	"name" text NOT NULL,
	"id" varchar(75) NOT NULL,
	"chain_id" bigint NOT NULL,
	"transaction_index" bigint NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "transactions_name_id_pk" PRIMARY KEY("name","id")
);
