import { z } from 'zod';
import { PublicUserSchema } from './auth.ts';
import { DiffFileSchema, DiffHunkSchema } from './diff/schemas.ts';
import { hasAtLeastRole, type WorkspaceRole } from './workspaces.ts';

export const REVIEW_STATUSES = ['open', 'closed'] as const;
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

/**
 * PATCH body: any of title, description and status, at least one. `description: null` (or blank)
 * clears it; a missing key leaves the field as it is.
 */
export const UpdateReviewRequestSchema = z
  .object({
    title: TitleSchema.optional(),
    description: DescriptionSchema.nullable()
      .transform((value) => value || null)
      .optional(),
    status: ReviewStatusSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Provide at least one of title, description and status.',
  });
export type UpdateReviewRequest = z.infer<typeof UpdateReviewRequestSchema>;

export const REVIEW_LIST_MAX_LIMIT = 50;

/** Query string of GET /reviews. Values arrive as strings, so `limit` is coerced. */
export const ListReviewsQuerySchema = z.object({
  status: ReviewStatusSchema.optional(),
  /** "me" for the caller, or a user id. */
  author: z.union([z.literal('me'), z.uuid()]).optional(),
  limit: z.coerce.number().int().min(1).max(REVIEW_LIST_MAX_LIMIT).default(20),
  /** Opaque: the `nextCursor` of the previous page. */
  cursor: z.string().optional(),
});
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;

export const ReviewListResponseSchema = z.object({
  /** Newest first. */
  items: z.array(ReviewSchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;

export const ReviewFileDiffSchema = z.object({
  file: ReviewFileSchema,
  hunks: z.array(DiffHunkSchema),
});
export type ReviewFileDiff = z.infer<typeof ReviewFileDiffSchema>;

/**
 * Whether a user with `actorRole` may edit, close, reopen or delete `review`: its author if they
 * are a member or above, or any admin or owner. Shared so the web UI offers only what the API
 * allows.
 */
export function canEditReview(
  actorRole: WorkspaceRole,
  actorId: string,
  review: Pick<Review, 'author'>,
): boolean {
  if (hasAtLeastRole(actorRole, 'admin')) return true;
  return hasAtLeastRole(actorRole, 'member') && review.author?.id === actorId;
}
