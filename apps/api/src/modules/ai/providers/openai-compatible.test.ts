import { APIConnectionError, APIConnectionTimeoutError, APIError } from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisContext } from '../context.js';
import { InvalidOutputError, ProviderError } from '../errors.js';
import {
  classifyError,
  createOpenAICompatibleProvider,
  parseRetryAfter,
  type ChatClient,
} from './openai-compatible.js';

const OPTIONS = {
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: 'test-api-key',
  model: 'openai/gpt-oss-120b',
  maxOutputTokens: 8000,
  timeoutMs: 60_000,
};

const CONTEXT: AnalysisContext = {
  files: [],
  skipped: [],
  totalFiles: 0,
  changedLines: 0,
  truncated: false,
};
const INPUT = { prompt: { system: 'system prompt', user: 'user prompt' }, context: CONTEXT };

function completion(
  content: string | null,
  finishReason: ChatCompletion.Choice['finish_reason'] = 'stop',
  usage: ChatCompletion['usage'] | null = {
    prompt_tokens: 1200,
    completion_tokens: 300,
    total_tokens: 1500,
  },
): ChatCompletion {
  return {
    id: 'cmpl',
    object: 'chat.completion',
    created: 0,
    model: OPTIONS.model,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        logprobs: null,
        message: { role: 'assistant', content, refusal: null },
      },
    ],
    ...(usage && { usage }),
  };
}

function clientReturning(...results: (ChatCompletion | Error)[]) {
  const create = vi.fn<ChatClient['chat']['completions']['create']>();
  for (const result of results) {
    if (result instanceof Error) create.mockRejectedValueOnce(result);
    else create.mockResolvedValueOnce(result);
  }
  return { client: { chat: { completions: { create } } }, create };
}

async function analyzeError(client: ChatClient): Promise<unknown> {
  return createOpenAICompatibleProvider(OPTIONS, client)
    .analyze(INPUT)
    .then(
      () => null,
      (err: unknown) => err,
    );
}

describe('openai-compatible provider', () => {
  it('asks for JSON with the configured model and token limit, and reads usage', async () => {
    const { client, create } = clientReturning(completion('{"summary":"ok","findings":[]}'));
    const output = await createOpenAICompatibleProvider(OPTIONS, client).analyze(INPUT);
    expect(output).toEqual({
      result: { summary: 'ok', findings: [] },
      raw: '{"summary":"ok","findings":[]}',
      usage: { inputTokens: 1200, outputTokens: 300 },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-oss-120b',
        max_completion_tokens: 8000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user prompt' },
        ],
      }),
    );
  });

  it('accepts JSON wrapped in a code fence and a response without usage', async () => {
    const { client } = clientReturning(
      completion('```json\n{"summary":"ok","findings":[]}\n```', 'stop', null),
    );
    const output = await createOpenAICompatibleProvider(OPTIONS, client).analyze(INPUT);
    expect(output.result).toEqual({ summary: 'ok', findings: [] });
    expect(output.usage).toBeNull();
  });

  it('sends the previous answer and the problem on a repair call', async () => {
    const { client, create } = clientReturning(completion('{"summary":"ok","findings":[]}'));
    await createOpenAICompatibleProvider(OPTIONS, client).analyze({
      ...INPUT,
      repair: { previousOutput: '{"summary": 1}', problem: 'summary must be a string' },
    });
    const messages = create.mock.calls[0]![0].messages;
    expect(messages).toHaveLength(4);
    expect(messages[2]).toEqual({ role: 'assistant', content: '{"summary": 1}' });
    expect(messages[3]).toMatchObject({ role: 'user' });
    expect(String(messages[3]!.content)).toContain('summary must be a string');
  });

  it.each([
    [
      'cut off by the token limit',
      completion('{"summary":"ok","findings":[', 'length'),
      'truncated',
    ],
    [
      'cut off even if it parses',
      completion('{"summary":"ok","findings":[]}', 'length'),
      'truncated',
    ],
    ['empty', completion(''), 'empty'],
    ['null content', completion(null), 'empty'],
    ['not JSON', completion('Here are my findings: none'), 'not_json'],
  ])(
    'treats a response that is %s as invalid output, keeping the usage',
    async (_n, res, reason) => {
      const { client } = clientReturning(res);
      const err = await analyzeError(client);
      expect(err).toBeInstanceOf(InvalidOutputError);
      expect((err as InvalidOutputError).reason).toBe(reason);
      expect((err as InvalidOutputError).usage).toEqual({ inputTokens: 1200, outputTokens: 300 });
    },
  );

  it.each([
    [429, { 'retry-after': '7' }, 'provider_rate_limited', true, 7_000],
    [429, { 'retry-after-ms': '1500' }, 'provider_rate_limited', true, 1_500],
    [429, {}, 'provider_rate_limited', true, undefined],
    [500, {}, 'provider_error', true, undefined],
    [503, {}, 'provider_error', true, undefined],
    [408, {}, 'provider_timeout', true, undefined],
    [400, {}, 'provider_bad_request', false, undefined],
    [401, {}, 'provider_auth', false, undefined],
    [403, {}, 'provider_auth', false, undefined],
    [404, {}, 'provider_model_not_found', false, undefined],
    [413, {}, 'provider_rejected', false, undefined],
  ])('maps HTTP %i %j to %s', async (status, headers, code, retryable, retryAfterMs) => {
    const error = APIError.generate(
      status,
      { error: { message: 'echoed prompt text' } },
      'error',
      new Headers(headers),
    );
    const err = await analyzeError(clientReturning(error).client);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code, retryable, retryAfterMs });
    expect((err as Error).message).not.toContain('echoed');
  });

  it('maps timeouts and network failures to retryable errors', () => {
    expect(classifyError(new APIConnectionTimeoutError())).toMatchObject({
      code: 'provider_timeout',
      retryable: true,
    });
    expect(classifyError(new APIConnectionError({ message: 'ECONNRESET' }))).toMatchObject({
      code: 'provider_unavailable',
      retryable: true,
    });
    expect(classifyError(new Error('something else'))).toBeNull();
  });

  it('passes unknown errors through unchanged', async () => {
    const boom = new TypeError('boom');
    expect(await analyzeError(clientReturning(boom).client)).toBe(boom);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds, milliseconds and HTTP dates', () => {
    const now = Date.parse('2026-11-12T10:00:00Z');
    expect(parseRetryAfter(new Headers({ 'retry-after': '2' }), now)).toBe(2_000);
    expect(parseRetryAfter(new Headers({ 'retry-after-ms': '250' }), now)).toBe(250);
    expect(
      parseRetryAfter(new Headers({ 'retry-after': 'Thu, 12 Nov 2026 10:00:30 GMT' }), now),
    ).toBe(30_000);
    expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }), now)).toBeUndefined();
    expect(parseRetryAfter(undefined, now)).toBeUndefined();
  });
});
