CREATE TABLE "review_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"review_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"old_path" text,
	"new_path" text,
	"change_type" text NOT NULL,
	"is_binary" boolean NOT NULL,
	"additions" integer NOT NULL,
	"deletions" integer NOT NULL,
	"hunks" jsonb NOT NULL,
	CONSTRAINT "review_files_review_id_position_unique" UNIQUE("review_id","position"),
	CONSTRAINT "review_files_change_type_check" CHECK ("review_files"."change_type" in ('added', 'deleted', 'modified', 'renamed'))
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"author_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"patch" text NOT NULL,
	"files_changed" integer NOT NULL,
	"additions" integer NOT NULL,
	"deletions" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_workspace_id_number_unique" UNIQUE("workspace_id","number"),
	CONSTRAINT "reviews_status_check" CHECK ("reviews"."status" in ('open', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "last_review_number" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_files" ADD CONSTRAINT "review_files_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_workspace_id_created_at_id_idx" ON "reviews" USING btree ("workspace_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reviews_author_id_idx" ON "reviews" USING btree ("author_id");