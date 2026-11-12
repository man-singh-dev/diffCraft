import type { AiJob, ReviewRoomEvents } from '@diffcraft/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../../plugins/db.js';
import { databaseTime } from '../realtime/publish.js';
import { safeError } from '../realtime/socket-server.js';

export type EmitToReview = <E extends keyof ReviewRoomEvents>(
  reviewId: string,
  event: E,
  payload: ReviewRoomEvents[E],
) => void;

export interface AnalysisPublisher {
  status(job: AiJob, actorId?: string | null): Promise<void>;
  completed(job: AiJob, findings: number): Promise<void>;
}

// Best effort, after the commit: clients that miss an event still get the state from GET …/analyses/latest.
export function createAnalysisPublisher(deps: {
  db: Pick<Database, 'execute'>;
  log: FastifyBaseLogger;
  emit: EmitToReview;
}): AnalysisPublisher {
  async function run(event: keyof ReviewRoomEvents, job: AiJob, send: (at: string) => void) {
    try {
      send(await databaseTime(deps.db));
    } catch (err) {
      deps.log.error({ err: safeError(err), event, jobId: job.id }, 'analysis publish failed');
    }
  }
  return {
    status: (job, actorId = null) =>
      run('analysis:status', job, (at) =>
        deps.emit(job.reviewId, 'analysis:status', { reviewId: job.reviewId, actorId, at, job }),
      ),
    completed: (job, findings) =>
      run('analysis:completed', job, (at) =>
        deps.emit(job.reviewId, 'analysis:completed', {
          reviewId: job.reviewId,
          actorId: null,
          at,
          jobId: job.id,
          findings,
        }),
      ),
  };
}
