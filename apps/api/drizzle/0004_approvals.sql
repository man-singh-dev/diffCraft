CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"review_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"decision" text NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_decisions_decision_check" CHECK ("review_decisions"."decision" in ('approve', 'request_changes'))
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"review_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_type_check" CHECK ("review_events"."type" in ('reviewer_assigned', 'reviewer_removed', 'decision', 'closed', 'reopened', 'merged'))
);
--> statement-breakpoint
CREATE TABLE "review_reviewers" (
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_reviewers_review_id_user_id_pk" PRIMARY KEY("review_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_status_check";--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "merged_by" uuid;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "required_approvals" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "require_resolved_threads" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reviewers" ADD CONSTRAINT "review_reviewers_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reviewers" ADD CONSTRAINT "review_reviewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reviewers" ADD CONSTRAINT "review_reviewers_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_decisions_review_id_reviewer_id_created_at_idx" ON "review_decisions" USING btree ("review_id","reviewer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "review_decisions_reviewer_id_idx" ON "review_decisions" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "review_events_review_id_created_at_idx" ON "review_events" USING btree ("review_id","created_at");--> statement-breakpoint
CREATE INDEX "review_events_actor_id_idx" ON "review_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "review_reviewers_user_id_idx" ON "review_reviewers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "review_reviewers_assigned_by_idx" ON "review_reviewers" USING btree ("assigned_by");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_merged_by_users_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_merged_by_idx" ON "reviews" USING btree ("merged_by");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_merged_check" CHECK (("reviews"."status" = 'merged') = ("reviews"."merged_at" is not null));--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_status_check" CHECK ("reviews"."status" in ('open', 'closed', 'merged'));--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_required_approvals_check" CHECK ("workspaces"."required_approvals" between 0 and 10);