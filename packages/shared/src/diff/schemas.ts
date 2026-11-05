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
  header: z.string(),
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  section: z.string().nullable(),
  lines: z.array(DiffLineSchema),
});
export type DiffHunk = z.infer<typeof DiffHunkSchema>;

export const DIFF_CHANGE_TYPES = ['added', 'deleted', 'modified', 'renamed'] as const;

export const DiffFileSchema = z.object({
  oldPath: z.string().nullable(),
  newPath: z.string().nullable(),
  changeType: z.enum(DIFF_CHANGE_TYPES),
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
