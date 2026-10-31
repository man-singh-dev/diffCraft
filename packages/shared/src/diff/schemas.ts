import { z } from 'zod';

export const DiffLineSchema = z.object({
  type: z.enum(['context', 'add', 'del']),
  /** The line without its leading "+", "-" or space. */
  content: z.string(),
  oldNumber: z.number().int().positive().nullable(),
  newNumber: z.number().int().positive().nullable(),
  noNewlineAtEnd: z.boolean(),
});
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const DiffHunkSchema = z.object({
  /** The full "@@ … @@" line. */
  header: z.string(),
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  /** Text after the second "@@" (usually the enclosing function), or null. */
  section: z.string().nullable(),
  lines: z.array(DiffLineSchema),
});
export type DiffHunk = z.infer<typeof DiffHunkSchema>;

export const DiffFileSchema = z.object({
  /** Null for an added file; the source for a copy. */
  oldPath: z.string().nullable(),
  /** Null for a deleted file. */
  newPath: z.string().nullable(),
  changeType: z.enum(['added', 'deleted', 'modified', 'renamed']),
  isBinary: z.boolean(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  hunks: z.array(DiffHunkSchema),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const ParsedPatchSchema = z.object({
  files: z.array(DiffFileSchema),
});
export type ParsedPatch = z.infer<typeof ParsedPatchSchema>;
