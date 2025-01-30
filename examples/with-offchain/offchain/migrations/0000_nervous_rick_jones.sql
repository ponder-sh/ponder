CREATE SCHEMA "offchain";
--> statement-breakpoint
CREATE TABLE "offchain"."metadata" (
	"tokenId" numeric(78, 0) PRIMARY KEY NOT NULL,
	"metadata" json
);
