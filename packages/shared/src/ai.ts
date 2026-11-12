import { z } from 'zod';

export const AI_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export const AiJobStatusSchema = z.enum(AI_JOB_STATUSES);
export type AiJobStatus = z.infer<typeof AiJobStatusSchema>;

export const AI_FINDING_CATEGORIES = ['bug', 'security', 'performance'] as const;
export const AiFindingCategorySchema = z.enum(AI_FINDING_CATEGORIES);
export type AiFindingCategory = z.infer<typeof AiFindingCategorySchema>;

export const AI_FINDING_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export const AiFindingSeveritySchema = z.enum(AI_FINDING_SEVERITIES);
export type AiFindingSeverity = z.infer<typeof AiFindingSeveritySchema>;

export const DIFF_SIDES = ['old', 'new'] as const;
export const DiffSideSchema = z.enum(DIFF_SIDES);
export type DiffSide = z.infer<typeof DiffSideSchema>;

export const AI_MAX_FINDINGS = 100;

// What the model must return. Untrusted: every field is bounded and lines are checked against the diff later.
export const AiFindingSchema = z.object({
  category: AiFindingCategorySchema,
  severity: AiFindingSeveritySchema,
  title: z.string().trim().min(1).max(200),
  explanation: z.string().trim().min(1).max(4000),
  suggestion: z.string().trim().max(4000).nullish(),
  file: z.string().min(1).max(1000).nullish(),
  side: DiffSideSchema.nullish(),
  lineStart: z.number().int().positive().nullish(),
  lineEnd: z.number().int().positive().nullish(),
  confidence: z.number().min(0).max(1),
});
export type AiFindingOutput = z.infer<typeof AiFindingSchema>;

export const AiAnalysisResultSchema = z.object({
  summary: z.string().trim().max(4000),
  findings: z.array(AiFindingSchema).max(AI_MAX_FINDINGS),
});
export type AiAnalysisResult = z.infer<typeof AiAnalysisResultSchema>;

export const AiJobSchema = z.object({
  id: z.uuid(),
  reviewId: z.uuid(),
  status: AiJobStatusSchema,
  requestedBy: z.uuid().nullable(),
  model: z.string(),
  promptVersion: z.string(),
  attempts: z.number().int().min(0),
  errorCode: z.string().nullable(),
  summary: z.string().nullable(),
  inputTokens: z.number().int().min(0).nullable(),
  outputTokens: z.number().int().min(0).nullable(),
  droppedFindings: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
export type AiJob = z.infer<typeof AiJobSchema>;

export const AiFindingDtoSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  reviewFileId: z.uuid().nullable(),
  filePath: z.string().nullable(),
  side: DiffSideSchema.nullable(),
  lineStart: z.number().int().positive().nullable(),
  lineEnd: z.number().int().positive().nullable(),
  category: AiFindingCategorySchema,
  severity: AiFindingSeveritySchema,
  title: z.string(),
  explanation: z.string(),
  suggestion: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  dismissedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AiFinding = z.infer<typeof AiFindingDtoSchema>;

// `job` is the newest job; `findings` come from the newest succeeded one, so they stay visible while a new run is queued.
export const LatestAnalysisResponseSchema = z.object({
  job: AiJobSchema.nullable(),
  findings: z.array(AiFindingDtoSchema),
});
export type LatestAnalysisResponse = z.infer<typeof LatestAnalysisResponseSchema>;
