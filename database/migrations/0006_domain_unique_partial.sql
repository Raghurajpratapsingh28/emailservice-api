-- Fix: domains_workspace_domain_uniq must be a partial index so that a deleted
-- domain can be re-added to the same workspace. Without this, soft-deleted rows
-- block re-registration and the insert throws an unhandled 500.
DROP INDEX IF EXISTS "domains_workspace_domain_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX "domains_workspace_domain_uniq"
  ON "domains" ("workspace_id", "domain")
  WHERE deleted_at IS NULL;
