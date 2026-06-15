-- BYODKIM support: each domain registration gets a unique DKIM selector +
-- public key so that DNS records published by a previous owner of the same
-- domain can never auto-verify a new workspace's identity.
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "dkim_selector" varchar(63);
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN IF NOT EXISTS "dkim_public_key" varchar(1024);
