import { AppError, NotFoundError } from '../../errors.js';
import type { TokenUsage } from './providers/types.js';

export class AiDisabledError extends AppError {
  constructor() {
    super(503, 'ai_disabled', 'AI analysis is turned off on this server.');
  }
}

export class ReviewNotOpenError extends AppError {
  constructor() {
    super(409, 'review_not_open', 'Only open reviews can be analyzed.');
  }
}

export class AnalysisLimitError extends AppError {
  constructor(limit: number, retryAfterSeconds: number) {
    super(
      429,
      'analysis_limit_reached',
      `This workspace has used its ${limit} AI analyses for the last 24 hours.`,
      { limit, retryAfterSeconds },
    );
    this.headers = { 'retry-after': String(retryAfterSeconds) };
  }
}

export class FindingNotFoundError extends NotFoundError {
  constructor() {
    super('finding_not_found', 'Finding not found in this review.');
  }
}

export type ProviderErrorCode =
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'provider_rate_limited'
  | 'provider_error'
  | 'provider_bad_request'
  | 'provider_auth'
  | 'provider_model_not_found'
  | 'provider_rejected';

// Message is a fixed string per code: provider error bodies can echo parts of the prompt.
export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}

export type InvalidOutputReason = 'truncated' | 'empty' | 'not_json' | 'schema';

// Carries the raw output only in memory, for the repair prompt; it is never logged or stored.
export class InvalidOutputError extends Error {
  constructor(
    readonly reason: InvalidOutputReason,
    readonly rawOutput: string | undefined,
    readonly usage: TokenUsage | null,
  ) {
    super(`invalid model output: ${reason}`);
    this.name = 'InvalidOutputError';
  }
}
