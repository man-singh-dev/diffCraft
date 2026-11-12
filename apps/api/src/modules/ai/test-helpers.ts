import { randomUUID } from 'node:crypto';
import {
  AiJobSchema,
  ReviewSchema,
  WorkspaceSchema,
  type AiAnalysisResult,
  type Review,
  type ReviewRoomEvents,
  type Workspace,
} from '@diffcraft/shared';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import type { TestUser } from '../../test/fixtures.js';
import { createAnalysisPublisher } from './events.js';
import type { AiProvider, AnalyzeInput, AnalyzeOutput } from './providers/types.js';
import type { AnalysisQueue } from './queue.js';

export const BASE = '/api/v1/workspaces';

// New side: 1 context, 2-3 added, 4 context. Old side: 1 context, 2 deleted, 3 context.
export const PATCH = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const apiKey = "super-secret-value-123";
 export { a, b };
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1 @@
-lockfileVersion: '9.0'
+lockfileVersion: '9.1'
diff --git a/logo.png b/logo.png
index d9d6533..a6a3e7f 100644
Binary files a/logo.png and b/logo.png differ
`;

export class FakeQueue implements AnalysisQueue {
  readonly enqueued: string[] = [];
  failNext = false;

  async enqueue(jobId: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('redis down');
    }
    this.enqueued.push(jobId);
  }

  async close(): Promise<void> {}
}

export interface RecordedEvent {
  event: keyof ReviewRoomEvents;
  payload: ReviewRoomEvents[keyof ReviewRoomEvents];
}

export function recordingPublisher(app: FastifyInstance) {
  const events: RecordedEvent[] = [];
  const publisher = createAnalysisPublisher({
    db: app.db,
    log: app.log,
    emit: (_reviewId, event, payload) => events.push({ event, payload }),
  });
  return { publisher, events };
}

type Step = AnalyzeOutput | Error | ((input: AnalyzeInput) => AnalyzeOutput);

export function scriptedProvider(...steps: Step[]): AiProvider & { calls: AnalyzeInput[] } {
  const calls: AnalyzeInput[] = [];
  return {
    model: 'scripted',
    calls,
    async analyze(input) {
      calls.push(input);
      const step = steps.shift();
      if (!step) throw new Error('no scripted step left');
      if (step instanceof Error) throw step;
      return typeof step === 'function' ? step(input) : step;
    },
  };
}

export function ok(result: unknown): AnalyzeOutput {
  return { result, raw: JSON.stringify(result), usage: { inputTokens: 100, outputTokens: 20 } };
}

export const finding = (
  overrides: Partial<AiAnalysisResult['findings'][number]> = {},
): AiAnalysisResult['findings'][number] => ({
  category: 'bug',
  severity: 'high',
  title: 'b changed',
  explanation: 'Callers expect b to be 2.',
  suggestion: null,
  file: 'src/app.ts',
  side: 'new',
  lineStart: 2,
  lineEnd: 2,
  confidence: 0.9,
  ...overrides,
});

export async function setupReview(
  app: FastifyInstance,
  owner: TestUser,
): Promise<{ workspace: Workspace; review: Review }> {
  const ws = await app.inject({
    method: 'POST',
    url: BASE,
    cookies: owner.cookies,
    payload: { name: `AI ${randomUUID()}` },
  });
  expect(ws.statusCode).toBe(201);
  const workspace = WorkspaceSchema.parse(ws.json());
  const rv = await app.inject({
    method: 'POST',
    url: `${BASE}/${workspace.id}/reviews`,
    cookies: owner.cookies,
    payload: { title: 'Change b', patch: PATCH },
  });
  expect(rv.statusCode).toBe(201);
  return { workspace, review: ReviewSchema.parse(rv.json()) };
}

export const analysesUrl = (workspaceId: string, review: Pick<Review, 'number'>, rest = '') =>
  `${BASE}/${workspaceId}/reviews/${review.number}${rest}`;

export async function startAnalysis(
  app: FastifyInstance,
  user: TestUser,
  workspaceId: string,
  review: Review,
) {
  const res = await app.inject({
    method: 'POST',
    url: analysesUrl(workspaceId, review, '/analyses'),
    cookies: user.cookies,
  });
  expect(res.statusCode).toBe(202);
  return AiJobSchema.parse(res.json());
}
