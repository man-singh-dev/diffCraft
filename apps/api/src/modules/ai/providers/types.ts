import type { AnalysisContext } from '../context.js';
import type { Prompt } from '../prompt.js';

export interface AnalyzeInput {
  prompt: Prompt;
  context: AnalysisContext;
  repair?: { previousOutput: string; problem: string };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AnalyzeOutput {
  result: unknown;
  raw: string;
  usage: TokenUsage | null;
}

// Throws ProviderError for API failures and InvalidOutputError when the answer is cut off, empty or not JSON.
export interface AiProvider {
  readonly model: string;
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
}
