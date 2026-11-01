import type { DiffParseErrorCode } from '@diffcraft/shared';
import { z } from 'zod';
import type { ApiFailure } from './api-client';
import { describeApiError } from './api-errors';

const PATCH_REASONS: Record<DiffParseErrorCode, string> = {
  empty_patch: 'The patch is empty.',
  too_large: 'The patch is larger than 1 MiB.',
  too_many_files: 'The patch changes more than 300 files.',
  too_many_lines: 'The patch has more than 20,000 lines.',
  line_too_long: 'A line is longer than 5,000 characters.',
  not_a_patch: "This doesn't look like a unified diff. Paste the output of git diff or diff -u.",
  malformed_header: 'A file header is malformed.',
  malformed_hunk: 'A hunk (@@ … @@ section) is malformed.',
  count_mismatch: "A hunk's lines don't match the counts in its @@ header.",
  unsupported_encoding:
    "The patch contains NUL characters, so it's probably UTF-16 or binary. Save the file as UTF-8.",
};

/** A message for a patch the parser rejects, from the preview or from the API. */
export function describePatchError(reason: string, line: number | null): string {
  const message =
    (PATCH_REASONS as Partial<Record<string, string>>)[reason] ?? "The patch couldn't be read.";
  return line === null ? message : `Line ${line}: ${message}`;
}

// error.details of a 400 invalid_patch (see InvalidPatchError in the API).
const InvalidPatchDetailsSchema = z.object({
  reason: z.string(),
  line: z.number().int().positive().nullable(),
});

const MESSAGES: Partial<Record<string, string>> = {
  payload_too_large: 'The patch is too large to send. A patch can be at most 1 MiB.',
  review_not_found: "This review doesn't exist any more. It may have been deleted.",
  forbidden:
    "You don't have permission to do that. Only the author or an admin can change a review.",
};

/** A message for a failed review call. 422 field errors are shown by their fields instead. */
export function describeReviewError(failure: ApiFailure): string {
  if (failure.code === 'invalid_patch') {
    const details = InvalidPatchDetailsSchema.safeParse(failure.details);
    return details.success
      ? describePatchError(details.data.reason, details.data.line)
      : failure.message;
  }
  return MESSAGES[failure.code] ?? describeApiError(failure);
}
