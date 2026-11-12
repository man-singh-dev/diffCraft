CREATE TABLE "finding_feedback" (
	"finding_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"helpful" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_feedback_finding_id_user_id_pk" PRIMARY KEY("finding_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "finding_feedback" ADD CONSTRAINT "finding_feedback_finding_id_ai_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."ai_findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_feedback" ADD CONSTRAINT "finding_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finding_feedback_user_id_idx" ON "finding_feedback" USING btree ("user_id");