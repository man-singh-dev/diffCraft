CREATE TABLE "comment_threads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"review_id" uuid NOT NULL,
	"file_id" uuid,
	"side" text,
	"line" integer,
	"line_content" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_threads_anchor_check" CHECK (num_nulls("comment_threads"."file_id", "comment_threads"."side", "comment_threads"."line", "comment_threads"."line_content") in (0, 4)),
	CONSTRAINT "comment_threads_side_check" CHECK ("comment_threads"."side" in ('old', 'new')),
	CONSTRAINT "comment_threads_line_check" CHECK ("comment_threads"."line" > 0),
	CONSTRAINT "comment_threads_status_check" CHECK ("comment_threads"."status" in ('open', 'resolved')),
	CONSTRAINT "comment_threads_resolved_check" CHECK (("comment_threads"."status" = 'resolved') = ("comment_threads"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_file_id_review_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."review_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_thread_id_comment_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."comment_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_threads_review_id_file_id_idx" ON "comment_threads" USING btree ("review_id","file_id");--> statement-breakpoint
CREATE INDEX "comment_threads_file_id_idx" ON "comment_threads" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "comment_threads_created_by_idx" ON "comment_threads" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "comment_threads_resolved_by_idx" ON "comment_threads" USING btree ("resolved_by");--> statement-breakpoint
CREATE INDEX "comments_thread_id_created_at_idx" ON "comments" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "comments_author_id_idx" ON "comments" USING btree ("author_id");