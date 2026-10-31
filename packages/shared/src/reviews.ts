import { z } from 'zod';
import { PublicUserSchema } from './auth.ts';
import { DiffFileSchema } from './diff/schemas.ts';

export const REVIEW_STATUSES = ['open', 'closed'] as const;
export const ReviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const CreateReviewRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z
    .string()
    .trim()
    .max(10_000)
    .nullish()
    .transform((value) => value || null),
  // Size and shape are checked by parsePatch, so its limits live in one place.
  patch: z.string().min(1),
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

export const ReviewSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  /** Per workspace, starting at 1: "#12". */
  number: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  status: ReviewStatusSchema,
  /** Null once the author's account is deleted. */
  author: PublicUserSchema.pick({ id: true, displayName: true }).nullable(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type Review = z.infer<typeof ReviewSchema>;

/** A file in a review without its hunks, which are loaded per file. */
export const ReviewFileSchema = DiffFileSchema.pick({
  oldPath: true,
  newPath: true,
  changeType: true,
  isBinary: true,
  additions: true,
  deletions: true,
}).extend({
  id: z.uuid(),
  /** 0-based order in the patch. */
  position: z.number().int().nonnegative(),
});
export type ReviewFile = z.infer<typeof ReviewFileSchema>;
