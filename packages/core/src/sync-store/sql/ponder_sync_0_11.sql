CREATE SCHEMA "ponder_sync_0_11";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."blocks" (LIKE "ponder_sync"."blocks" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."blocks" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."blocks";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."factories" (LIKE "ponder_sync"."factories" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."factories" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."factories";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."factory_addresses" (LIKE "ponder_sync"."factory_addresses" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."factory_addresses" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."factory_addresses";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."intervals" (LIKE "ponder_sync"."intervals" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."intervals" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."intervals";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."logs" (LIKE "ponder_sync"."logs" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."logs" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."logs";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."rpc_request_results" (LIKE "ponder_sync"."rpc_request_results" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."rpc_request_results" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."rpc_request_results";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."traces" (LIKE "ponder_sync"."traces" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."traces" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."traces";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."transaction_receipts" (LIKE "ponder_sync"."transaction_receipts" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."transaction_receipts" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."transaction_receipts";
--> statement-breakpoint
CREATE TABLE "ponder_sync_0_11"."transactions" (LIKE "ponder_sync"."transactions" INCLUDING ALL);
--> statement-breakpoint
INSERT INTO "ponder_sync_0_11"."transactions" OVERRIDING SYSTEM VALUE
SELECT * FROM "ponder_sync"."transactions";
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('ponder_sync_0_11.factories', 'id'), (SELECT MAX(id) FROM "ponder_sync"."factories"));
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('ponder_sync_0_11.factory_addresses', 'id'), (SELECT MAX(id) FROM "ponder_sync"."factory_addresses"));
