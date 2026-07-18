CREATE TABLE "account_deletion_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"purge_after" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text,
	"completed_at" timestamp,
	CONSTRAINT "account_deletion_requests_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"normalized_email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_normalized_email_unique" UNIQUE("normalized_email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_state" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"state_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text,
	"captured_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"capability_key" text NOT NULL,
	"connector_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tick_id" text,
	"idempotency_key" text NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"cost_units" numeric(10, 4),
	"output" jsonb,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel_ticks" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"trigger_user_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"reclaimed_ghosts" integer DEFAULT 0 NOT NULL,
	"orgs_scanned" integer DEFAULT 0 NOT NULL,
	"entities_scanned" integer DEFAULT 0 NOT NULL,
	"enqueued" integer DEFAULT 0 NOT NULL,
	"skipped_already_enqueued" integer DEFAULT 0 NOT NULL,
	"skipped_by_cadence" integer DEFAULT 0 NOT NULL,
	"skipped_by_entity_scope" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"drain_timed_out" boolean DEFAULT false NOT NULL,
	"drain_limit" integer,
	"drain_concurrency" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "signal_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"user_id" text NOT NULL,
	"rating" text NOT NULL,
	"reason" text,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"run_id" text,
	"capability_key" text NOT NULL,
	"category" text NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"captured_date" date NOT NULL,
	"primary_score" numeric(12, 2),
	"score_direction" text,
	"payload" jsonb NOT NULL,
	"has_data_issues" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject_entity_id" text NOT NULL,
	"capability_key" text NOT NULL,
	"severity" text DEFAULT 'p2' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"evidence" jsonb NOT NULL,
	"confidence" numeric(3, 2) DEFAULT '0.75' NOT NULL,
	"dedup_key" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"domain" text NOT NULL,
	"brand_name" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_intel_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled_capabilities" jsonb DEFAULT '{"seo_rank":true,"seo_keyword_gap":true,"seo_keyword_changes":true,"seo_keyword_intent":true,"seo_serp_features":true,"seo_sov":true,"seo_traffic_trend":true,"seo_top_pages":true,"seo_backlinks":true,"seo_cwv":true,"seo_content_score":true,"seo_content_freshness":true,"seo_competitor_pages":true,"seo_answer_box":true,"seo_local_rank":false,"seo_international_rank":false,"seo_sitemap_diff":true,"seo_index_coverage":true,"seo_noindex_alert":true,"seo_canonical_drift":true,"seo_content_decay":true,"seo_ctr_anomaly":false,"seo_error_spike":true,"seo_internal_linking":false,"seo_backlink_changes":false,"seo_cannibalization":true,"seo_indexation_health":true,"seo_authority_score":true,"seo_site_health":true,"seo_position_distribution":true,"seo_traffic_value":true,"seo_serp_volatility":true,"geo_citations":true,"geo_mentions":true,"geo_mentions_geo":false,"geo_engine_citations":true,"geo_keyword_citations":true,"geo_citation_sources":true,"geo_citation_velocity":true,"geo_citation_authority":true,"geo_citation_why":true,"geo_co_citations":true,"geo_accuracy_audit":true,"geo_traffic_estimate":true,"geo_traffic_lift":false,"geo_competitor_visibility":true,"geo_visibility_score":true,"geo_alternatives":true,"geo_content_gap":true,"geo_social_signals":false,"geo_prompt_research":false,"geo_youtube_citations":false,"geo_shopping_citation":false,"geo_sentiment":true,"geo_answer_position":true,"geo_citation_taxonomy":true,"geo_ai_search_volume":false,"mentions_brand":true,"mentions_keyword":true,"brand_lookalike_domains":true,"brand_phishing":false,"brand_trademark_abuse":false,"social_youtube_mentions":true,"pr_news_coverage":true}'::jsonb NOT NULL,
	"cost_cap_micro_usd" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"signal_count" numeric(10, 0) DEFAULT '0' NOT NULL,
	"output" jsonb,
	"model" text,
	"cost_units" numeric(10, 4),
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intel_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mention_records" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"run_id" text,
	"capability_key" text NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"body" text NOT NULL,
	"context" text,
	"author_name" text,
	"author_handle" text,
	"author_followers" integer,
	"engagement_score" integer,
	"comments" integer,
	"shares" integer,
	"impressions" integer,
	"sentiment" text,
	"signal_type" text,
	"priority" text,
	"is_influencer" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"captured_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"entity_id" text,
	"run_id" text,
	"capability_key" text,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"unit_type" text NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"cost_source" text DEFAULT 'unknown' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"http_status" smallint,
	"attempt" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_state" ADD CONSTRAINT "entity_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_state" ADD CONSTRAINT "entity_state_entity_id_tracked_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_runs" ADD CONSTRAINT "connector_runs_entity_id_tracked_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_ticks" ADD CONSTRAINT "intel_ticks_trigger_user_id_user_id_fk" FOREIGN KEY ("trigger_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_feedback" ADD CONSTRAINT "signal_feedback_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_feedback" ADD CONSTRAINT "signal_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_snapshots" ADD CONSTRAINT "signal_snapshots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_snapshots" ADD CONSTRAINT "signal_snapshots_entity_id_tracked_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_snapshots" ADD CONSTRAINT "signal_snapshots_run_id_connector_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."connector_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_subject_entity_id_tracked_entities_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_entities" ADD CONSTRAINT "tracked_entities_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_intel_settings" ADD CONSTRAINT "user_intel_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_runs" ADD CONSTRAINT "digest_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_conversations" ADD CONSTRAINT "intel_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intel_messages" ADD CONSTRAINT "intel_messages_conversation_id_intel_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."intel_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_records" ADD CONSTRAINT "mention_records_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_records" ADD CONSTRAINT "mention_records_entity_id_tracked_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention_records" ADD CONSTRAINT "mention_records_run_id_connector_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."connector_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_events" ADD CONSTRAINT "api_usage_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_events" ADD CONSTRAINT "api_usage_events_entity_id_tracked_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."tracked_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_events" ADD CONSTRAINT "api_usage_events_run_id_connector_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."connector_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_purge_idx" ON "account_deletion_requests" USING btree ("status","purge_after");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_state_entity_key_uidx" ON "entity_state" USING btree ("entity_id","state_key");--> statement-breakpoint
CREATE INDEX "entity_state_user_idx" ON "entity_state" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_runs_idem_uidx" ON "connector_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "connector_runs_user_idx" ON "connector_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "connector_runs_entity_idx" ON "connector_runs" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "connector_runs_status_idx" ON "connector_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "connector_runs_status_created_idx" ON "connector_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "connector_runs_tick_id_idx" ON "connector_runs" USING btree ("tick_id");--> statement-breakpoint
CREATE INDEX "intel_ticks_started_at_idx" ON "intel_ticks" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "intel_ticks_trigger_user_idx" ON "intel_ticks" USING btree ("trigger_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_feedback_signal_user_uidx" ON "signal_feedback" USING btree ("signal_id","user_id");--> statement-breakpoint
CREATE INDEX "signal_feedback_signal_idx" ON "signal_feedback" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "signal_feedback_user_idx" ON "signal_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signal_snapshots_entity_cap_date_idx" ON "signal_snapshots" USING btree ("entity_id","capability_key","captured_date");--> statement-breakpoint
CREATE INDEX "snapshots_user_category_date_idx" ON "signal_snapshots" USING btree ("user_id","category","captured_date");--> statement-breakpoint
CREATE INDEX "signal_snapshots_entity_cap_idx" ON "signal_snapshots" USING btree ("entity_id","capability_key");--> statement-breakpoint
CREATE INDEX "signal_snapshots_user_entity_cap_idx" ON "signal_snapshots" USING btree ("user_id","entity_id","capability_key");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_snapshots_daily_uidx" ON "signal_snapshots" USING btree ("entity_id","capability_key","captured_date");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_dedup_uidx" ON "signals" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "signals_user_created_idx" ON "signals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "signals_entity_idx" ON "signals" USING btree ("subject_entity_id");--> statement-breakpoint
CREATE INDEX "signals_capability_idx" ON "signals" USING btree ("capability_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_entities_user_domain_uidx" ON "tracked_entities" USING btree ("user_id","domain");--> statement-breakpoint
CREATE INDEX "tracked_entities_user_idx" ON "tracked_entities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "digest_runs_user_period_uidx" ON "digest_runs" USING btree ("user_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "digest_runs_user_created_idx" ON "digest_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "intel_conversations_user_idx" ON "intel_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "intel_conversations_updated_idx" ON "intel_conversations" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "intel_messages_conversation_idx" ON "intel_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mention_records_dedup_uidx" ON "mention_records" USING btree ("entity_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "mention_records_entity_posted_idx" ON "mention_records" USING btree ("entity_id","capability_key","posted_at");--> statement-breakpoint
CREATE INDEX "mention_records_entity_priority_idx" ON "mention_records" USING btree ("entity_id","priority");--> statement-breakpoint
CREATE INDEX "mention_records_user_signal_idx" ON "mention_records" USING btree ("user_id","signal_type");--> statement-breakpoint
CREATE INDEX "api_usage_provider_created_at_idx" ON "api_usage_events" USING btree ("provider","created_at");--> statement-breakpoint
CREATE INDEX "api_usage_user_created_at_idx" ON "api_usage_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_usage_capability_created_at_idx" ON "api_usage_events" USING btree ("capability_key","created_at");--> statement-breakpoint
CREATE INDEX "api_usage_run_id_idx" ON "api_usage_events" USING btree ("run_id");