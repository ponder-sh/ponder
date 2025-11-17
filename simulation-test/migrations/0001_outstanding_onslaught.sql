CREATE TABLE "metadata" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seed" text NOT NULL,
	"app" text NOT NULL,
	"commit" text NOT NULL,
	"branch" text NOT NULL,
	"version" text NOT NULL,
	"time" timestamp NOT NULL,
	"ci" boolean NOT NULL,
	"success" boolean NOT NULL
);
