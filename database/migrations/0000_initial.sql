CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(200) NOT NULL,
	"plan" varchar(32) DEFAULT 'free' NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"locale" varchar(16) DEFAULT 'en-US' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"email_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feature_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhook_settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_normalized" varchar(254) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"failed_login_window_start" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(128) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"weight" varchar(16) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_user_id" uuid,
	"action" varchar(100) NOT NULL,
	"target_type" varchar(64),
	"target_id" varchar(128),
	"success" boolean DEFAULT true NOT NULL,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"metadata" jsonb,
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_normalized" varchar(254) NOT NULL,
	"role_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"requested_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"previous_token_hash" varchar(128),
	"rotation_grace_until" timestamp with time zone,
	"family_id" uuid NOT NULL,
	"replaced_by_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" varchar(512),
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"key_hash" varchar(128) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"scope" varchar(256) DEFAULT 'events.write' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"rate_limit" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"ses_identity" varchar(253) NOT NULL,
	"ses_identity_arn" varchar(512),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"dkim_tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_started_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"last_verification_check_at" timestamp with time zone,
	"verification_attempts" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"send_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"sender_email" varchar(254) NOT NULL,
	"sender_name" varchar(200),
	"reply_to" varchar(254),
	"recipient_email" varchar(254) NOT NULL,
	"recipient_name" varchar(200),
	"subject" varchar(998) NOT NULL,
	"html_body" text,
	"text_body" text,
	"template_id" uuid,
	"template_version" integer,
	"template_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider" varchar(32) DEFAULT 'ses' NOT NULL,
	"provider_message_id" varchar(255),
	"failure_reason" text,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"subject" varchar(998) NOT NULL,
	"html_body" text,
	"text_body" text,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" varchar(1000),
	"filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"estimated_count" integer DEFAULT 0 NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" varchar(254) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"provider_message_id" varchar(255),
	"failure_reason" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"type" varchar(32) DEFAULT 'regular' NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"subject" varchar(998),
	"preview_text" varchar(200),
	"sender_email" varchar(254),
	"sender_name" varchar(200),
	"reply_to" varchar(254),
	"html_body" text,
	"text_body" text,
	"template_id" uuid,
	"segment_id" uuid,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"send_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "event_debug_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"processing_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_schemas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_name" varchar(512) NOT NULL,
	"schema_definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_mode" varchar(8) DEFAULT 'soft' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events_raw" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"event_type" varchar(16) NOT NULL,
	"event_name" varchar(512),
	"user_id" varchar(512),
	"anonymous_id" varchar(512),
	"group_id" varchar(512),
	"traits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"original_timestamp" timestamp with time zone,
	"normalized_timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_debug_logs" ADD CONSTRAINT "event_debug_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_debug_logs" ADD CONSTRAINT "event_debug_logs_event_id_events_raw_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events_raw"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_schemas" ADD CONSTRAINT "event_schemas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_raw" ADD CONSTRAINT "events_raw_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events_raw" ADD CONSTRAINT "events_raw_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_uniq" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "workspaces_plan_idx" ON "workspaces" USING btree ("plan");--> statement-breakpoint
CREATE INDEX "workspaces_status_idx" ON "workspaces" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_settings_workspace_uniq" ON "workspace_settings" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_normalized_uniq" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_active_idx" ON "users" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_slug_uniq" ON "permissions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "role_permissions_perm_idx" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_slug_uniq" ON "roles" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_user_uniq" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_role_idx" ON "workspace_members" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_idx" ON "audit_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_uniq" ON "email_verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_expires_idx" ON "email_verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invites_token_hash_uniq" ON "invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invites_workspace_email_idx" ON "invites" USING btree ("workspace_id","email_normalized");--> statement-breakpoint
CREATE INDEX "invites_email_idx" ON "invites" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "invites_expires_idx" ON "invites" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_uniq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_token_hash_uniq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_prev_hash_idx" ON "refresh_tokens" USING btree ("previous_token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_active_idx" ON "refresh_tokens" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_uniq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "api_keys_active_idx" ON "api_keys" USING btree ("workspace_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_workspace_domain_uniq" ON "domains" USING btree ("workspace_id","domain");--> statement-breakpoint
CREATE INDEX "domains_workspace_idx" ON "domains" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "domains_status_idx" ON "domains" USING btree ("status");--> statement-breakpoint
CREATE INDEX "domains_domain_idx" ON "domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domains_active_idx" ON "domains" USING btree ("workspace_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_sends_send_id_uniq" ON "email_sends" USING btree ("send_id");--> statement-breakpoint
CREATE INDEX "email_sends_workspace_idx" ON "email_sends" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "email_sends_workspace_created_idx" ON "email_sends" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "email_sends_status_idx" ON "email_sends" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_sends_recipient_idx" ON "email_sends" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "email_sends_provider_msg_idx" ON "email_sends" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_workspace_name_version_uniq" ON "email_templates" USING btree ("workspace_id","name","version");--> statement-breakpoint
CREATE INDEX "email_templates_workspace_idx" ON "email_templates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "email_templates_workspace_name_idx" ON "email_templates" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "email_templates_status_idx" ON "email_templates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_workspace_name_uniq" ON "segments" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "segments_workspace_idx" ON "segments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "segments_status_idx" ON "segments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_recipients_campaign_email_uniq" ON "campaign_recipients" USING btree ("campaign_id","email");--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_idx" ON "campaign_recipients" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_workspace_idx" ON "campaign_recipients" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "campaign_recipients_status_idx" ON "campaign_recipients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_email_idx" ON "campaign_recipients" USING btree ("email");--> statement-breakpoint
CREATE INDEX "campaign_recipients_provider_msg_idx" ON "campaign_recipients" USING btree ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_workspace_name_uniq" ON "campaigns" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_idx" ON "campaigns" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "campaigns_segment_idx" ON "campaigns" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "campaigns_scheduled_at_idx" ON "campaigns" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_created_idx" ON "campaigns" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "event_debug_logs_workspace_idx" ON "event_debug_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "event_debug_logs_event_idx" ON "event_debug_logs" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_schemas_workspace_name_uniq" ON "event_schemas" USING btree ("workspace_id","event_name");--> statement-breakpoint
CREATE INDEX "event_schemas_workspace_idx" ON "event_schemas" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "event_schemas_active_idx" ON "event_schemas" USING btree ("workspace_id","is_active");--> statement-breakpoint
CREATE INDEX "events_raw_workspace_idx" ON "events_raw" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "events_raw_workspace_received_idx" ON "events_raw" USING btree ("workspace_id","received_at");--> statement-breakpoint
CREATE INDEX "events_raw_event_name_idx" ON "events_raw" USING btree ("event_name");--> statement-breakpoint
CREATE INDEX "events_raw_user_id_idx" ON "events_raw" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "events_raw_anon_id_idx" ON "events_raw" USING btree ("anonymous_id");--> statement-breakpoint
CREATE INDEX "events_raw_status_idx" ON "events_raw" USING btree ("status");--> statement-breakpoint
CREATE INDEX "events_raw_api_key_idx" ON "events_raw" USING btree ("api_key_id");