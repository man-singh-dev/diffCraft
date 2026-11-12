import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { InvalidOutputError, ProviderError } from '../errors.js';
import { buildRepairPrompt } from '../prompt.js';
import type { AiProvider, AnalyzeInput } from './types.js';

export interface OpenAICompatibleOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ChatClient {
  chat: {
    completions: {
      create(body: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletion>;
    };
  };
}

const MAX_REPAIR_ECHO_CHARS = 20_000;

export function parseRetryAfter(
  headers: Headers | undefined,
  now = Date.now(),
): number | undefined {
  const ms = Number(headers?.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const value = headers?.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function classifyError(err: unknown): ProviderError | null {
  if (err instanceof APIConnectionTimeoutError || err instanceof APIUserAbortError) {
    return new ProviderError('provider_timeout', true);
  }
  if (err instanceof APIConnectionError) return new ProviderError('provider_unavailable', true);
  if (!(err instanceof APIError) || err.status === undefined) return null;
  const status = err.status;
  if (status === 429) {
    return new ProviderError('provider_rate_limited', true, parseRetryAfter(err.headers));
  }
  if (status === 408) return new ProviderError('provider_timeout', true);
  if (status >= 500 || status === 409) return new ProviderError('provider_error', true);
  if (status === 400) return new ProviderError('provider_bad_request', false);
  if (status === 401 || status === 403) return new ProviderError('provider_auth', false);
  if (status === 404) return new ProviderError('provider_model_not_found', false);
  return new ProviderError('provider_rejected', false);
}

function messagesFor({ prompt, repair }: AnalyzeInput): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
  if (repair) {
    messages.push(
      { role: 'assistant', content: repair.previousOutput.slice(0, MAX_REPAIR_ECHO_CHARS) },
      { role: 'user', content: buildRepairPrompt(repair.problem) },
    );
  }
  return messages;
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleOptions,
  client: ChatClient = new OpenAI({
    baseURL: options.baseURL,
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    // BullMQ owns retries, with backoff and the job's attempt count.
    maxRetries: 0,
  }),
): AiProvider {
  return {
    model: options.model,
    async analyze(input) {
      let completion: ChatCompletion;
      try {
        completion = await client.chat.completions.create({
          model: options.model,
          messages: messagesFor(input),
          response_format: { type: 'json_object' },
          max_completion_tokens: options.maxOutputTokens,
          temperature: 0,
        });
      } catch (err) {
        throw classifyError(err) ?? err;
      }

      const usage = completion.usage
        ? {
            inputTokens: completion.usage.prompt_tokens ?? 0,
            outputTokens: completion.usage.completion_tokens ?? 0,
          }
        : null;
      const choice = completion.choices[0];
      const raw = choice?.message?.content?.trim() ?? '';
      // Reasoning models spend output tokens thinking first: hitting the limit can leave half a JSON object.
      if (choice?.finish_reason === 'length') throw new InvalidOutputError('truncated', raw, usage);
      if (!raw) throw new InvalidOutputError('empty', undefined, usage);
      try {
        return { result: JSON.parse(stripCodeFence(raw)), raw, usage };
      } catch {
        throw new InvalidOutputError('not_json', raw, usage);
      }
    },
  };
}

function stripCodeFence(text: string): string {
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return match ? match[1]! : text;
}
