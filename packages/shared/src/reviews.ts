import { z } from 'zod';
import { PublicUserSchema } from './auth.ts';
import { DiffFileSchema, DiffHunkSchema } from './diff/schemas.ts';
import { hasAtLeastRole, type WorkspaceRole } from './workspaces.ts';

export const REVIEW_STATUSES = ['open', 'closed', 'merged'] as const;
export const ReviewStatusSchema = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

// Postgres text can't store U+0000, so it is refused here rather than failing in the database.
const noNul = (value: string) => !value.includes('\0');
const NUL_MESSAGE = 'Must not contain NUL characters.';

const TitleSchema = z.string().trim().min(1).max(200).refine(noNul, NUL_MESSAGE);
const DescriptionSchema = z.string().trim().max(10_000).refine(noNul, NUL_MESSAGE);

export const CreateReviewRequestSchema = z.object({
  title: TitleSchema,
  description: DescriptionSchema.nullish().transform((value) => value || null),
  // Size, shape and encoding are checked by parsePatch, so its limits live in one place.
  patch: z.string().min(1),
});
export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

export const ReviewSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  number: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  status: ReviewStatusSchema,
  author: PublicUserSchema.pick({ id: true, displayName: true }).nullable(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ReviewFileSchema = DiffFileSchema.pick({
  oldPath: true,
  newPath: true,
  changeType: true,
  isBinary: true,
  additions: true,
  deletions: true,
}).extend({
  id: z.uuid(),
  position: z.number().int().nonnegative(),
});
export type ReviewFile = z.infer<typeof ReviewFileSchema>;

/** `description: null` (or blank) clears it; a missing key leaves the field as it is. */
export const UpdateReviewRequestSchema = z
  .object({
    title: TitleSchema.optional(),
    description: DescriptionSchema.nullable()
      .transform((value) => value || null)
      .optional(),
    // Merging has its own checks, so it can't be done by setting the status.
    status: z.enum(['open', 'closed']).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one of title, description and status.',
  });
export type UpdateReviewRequest = z.infer<typeof UpdateReviewRequestSchema>;

export const REVIEW_LIST_MAX_LIMIT = 50;

/** Values arrive as strings, so `limit` is coerced. */
export const ListReviewsQuerySchema = z.object({
  status: ReviewStatusSchema.optional(),
  author: z.union([z.literal('me'), z.uuid()]).optional(),
  limit: z.coerce.number().int().min(1).max(REVIEW_LIST_MAX_LIMIT).default(20),
  cursor: z.string().optional(),
});
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;

export const ReviewListResponseSchema = z.object({
  items: z.array(ReviewSchema),
  nextCursor: z.string().nullable(),
});
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;

export const ReviewFileDiffSchema = z.object({
  file: ReviewFileSchema,
  hunks: z.array(DiffHunkSchema),
});
export type ReviewFileDiff = z.infer<typeof ReviewFileDiffSchema>;

export function canEditReview(
  actorRole: WorkspaceRole,
  actorId: string,
  review: Pick<Review, 'author'>,
): boolean {
  if (hasAtLeastRole(actorRole, 'admin')) return true;
  return hasAtLeastRole(actorRole, 'member') && review.author?.id === actorId;
}
