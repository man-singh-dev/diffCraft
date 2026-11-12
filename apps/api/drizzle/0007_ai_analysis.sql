CREATE TABLE "ai_analysis_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"requested_by" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"idempotency_key" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"summary" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"dropped_findings" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_analysis_jobs_status_check" CHECK ("ai_analysis_jobs"."status" in ('queued', 'running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "ai_findings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"review_file_id" uuid,
	"side" text,
	"line_start" integer,
	"line_end" integer,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"explanation" text NOT NULL,
	"suggestion" text,
	"confidence" real NOT NULL,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_findings_side_check" CHECK ("ai_findings"."side" in ('old', 'new')),
	CONSTRAINT "ai_findings_category_check" CHECK ("ai_findings"."category" in ('bug', 'security', 'performance')),
	CONSTRAINT "ai_findings_severity_check" CHECK ("ai_findings"."severity" in ('info', 'low', 'medium', 'high', 'critical')),
	CONSTRAINT "ai_findings_confidence_check" CHECK ("ai_findings"."confidence" >= 0 and "ai_findings"."confidence" <= 1)
);
--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD CONSTRAINT "ai_analysis_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD CONSTRAINT "ai_analysis_jobs_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analysis_jobs" ADD CONSTRAINT "ai_analysis_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_findings" ADD CONSTRAINT "ai_findings_job_id_ai_analysis_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_analysis_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_findings" ADD CONSTRAINT "ai_findings_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_findings" ADD CONSTRAINT "ai_findings_review_file_id_review_files_id_fk" FOREIGN KEY ("review_file_id") REFERENCES "public"."review_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_analysis_jobs_active_idempotency_key_unique" ON "ai_analysis_jobs" USING btree ("idempotency_key") WHERE "ai_analysis_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "ai_analysis_jobs_review_id_created_at_idx" ON "ai_analysis_jobs" USING btree ("review_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ai_analysis_jobs_workspace_id_created_at_idx" ON "ai_analysis_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_analysis_jobs_requested_by_idx" ON "ai_analysis_jobs" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "ai_analysis_jobs_status_idx" ON "ai_analysis_jobs" USING btree ("status") WHERE "ai_analysis_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "ai_findings_review_id_idx" ON "ai_findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "ai_findings_job_id_idx" ON "ai_findings" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ai_findings_review_file_id_idx" ON "ai_findings" USING btree ("review_file_id");