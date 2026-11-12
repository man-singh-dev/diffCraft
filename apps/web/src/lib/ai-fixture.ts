import type { AiFinding, AiJob } from '@diffcraft/shared';

export const AI_REVIEW = '01a17e5e-aa56-7985-be46-bf5f1c7e7f10';
export const AI_FILE = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd2';
export const AI_JOB = '01a17e5e-aa56-7985-be46-bf5f1c7e7f30';

let n = 0;
export const aiId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

export function aiJob(overrides: Partial<AiJob> = {}): AiJob {
  return {
    id: AI_JOB,
    reviewId: AI_REVIEW,
    status: 'succeeded',
    requestedBy: null,
    model: 'gpt-oss-120b',
    promptVersion: 'review-v1',
    attempts: 1,
    errorCode: null,
    summary: 'Adds a cache.',
    inputTokens: 100,
    outputTokens: 50,
    droppedFindings: 0,
    createdAt: '2026-11-12T10:00:00.000Z',
    startedAt: '2026-11-12T10:00:01.000Z',
    finishedAt: '2026-11-12T10:00:30.000Z',
    ...overrides,
  };
}

export function aiFinding(overrides: Partial<AiFinding> = {}): AiFinding {
  return {
    id: aiId(),
    jobId: AI_JOB,
    reviewFileId: AI_FILE,
    filePath: 'src/app.ts',
    side: 'new',
    lineStart: 2,
    lineEnd: 2,
    category: 'bug',
    severity: 'medium',
    title: 'Off by one',
    explanation: 'The loop skips the last item.',
    suggestion: null,
    confidence: 0.8,
    dismissedAt: null,
    createdAt: '2026-11-12T10:00:30.000Z',
    myFeedback: null,
    feedback: { helpful: 0, notHelpful: 0 },
    ...overrides,
  };
}
