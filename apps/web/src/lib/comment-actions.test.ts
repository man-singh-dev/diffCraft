import type { Comment, Thread } from '@diffcraft/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerApiResult, ServerSendResult } from './api.server.js';
import { toCommentError } from './comment-errors.js';

// server-only throws outside a React Server Components build.
vi.mock('server-only', () => ({}));
const api = {
  postThread: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<Thread>>>(),
  postReply: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<Comment>>>(),
  patchComment: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<Comment>>>(),
  deleteCommentRequest: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<Comment>>>(),
  patchThreadStatus: vi.fn<(...args: unknown[]) => Promise<ServerSendResult<Thread>>>(),
  getThreads: vi.fn<(...args: unknown[]) => Promise<ServerApiResult<Thread[]>>>(),
};
vi.mock('./api.server', () => api);

const { createThread, deleteComment, editComment, loadThreads, replyToThread, setThreadStatus } =
  await import('./comment-actions.js');

const WS = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const THREAD = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd0';
const COMMENT = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd1';
const FILE = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd2';

const COMMENT_DATA: Comment = {
  id: COMMENT,
  threadId: THREAD,
  author: { id: WS, displayName: 'Ada' },
  body: 'Hi',
  createdAt: '2026-11-05T10:00:00.000Z',
  edited: false,
  deleted: false,
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

const notCalled = () => {
  for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
};

describe('argument validation (no API call)', () => {
  it.each([
    ['workspace id not a uuid', ['nope', '1']],
    ['workspace id with a path', [`../${WS}`, '1']],
    ['review number with a leading zero', [WS, '01']],
    ['review number over int4', [WS, '2147483648']],
    ['review number as a number', [WS, 1]],
  ])('%s → not_found', async (_name, [ws, number]) => {
    for (const result of [
      await createThread(ws, number, { body: 'x' }),
      await replyToThread(ws, number, THREAD, { body: 'x' }),
      await editComment(ws, number, THREAD, COMMENT, { body: 'x' }),
      await deleteComment(ws, number, THREAD, COMMENT),
      await setThreadStatus(ws, number, THREAD, { status: 'resolved' }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    notCalled();
  });

  it.each([['nope'], [`${THREAD}/../x`], [undefined], [42]])(
    'thread or comment id %j → not_found',
    async (bad) => {
      for (const result of [
        await replyToThread(WS, '1', bad, { body: 'x' }),
        await editComment(WS, '1', bad, COMMENT, { body: 'x' }),
        await editComment(WS, '1', THREAD, bad, { body: 'x' }),
        await deleteComment(WS, '1', THREAD, bad),
        await setThreadStatus(WS, '1', bad, { status: 'open' }),
      ]) {
        expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
      }
      notCalled();
    },
  );

  it.each([
    ['empty', { body: '' }],
    ['whitespace only', { body: '  \n ' }],
    ['too long', { body: 'x'.repeat(10_001) }],
    ['with a NUL', { body: 'a\u0000b' }],
    ['not an object', 'hello'],
  ])('body %s → invalid, with a body error', async (_name, input) => {
    for (const result of [
      await createThread(WS, '1', input),
      await replyToThread(WS, '1', THREAD, input),
      await editComment(WS, '1', THREAD, COMMENT, input),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid' } });
    }
    notCalled();
  });

  it.each([
    { fileId: 'nope', side: 'new', line: 1 },
    { fileId: FILE, side: 'left', line: 1 },
    { fileId: FILE, side: 'old', line: 0 },
    { fileId: FILE, side: 'old', line: 1.5 },
  ])('anchor %j → invalid', async (anchor) => {
    expect(await createThread(WS, '1', { body: 'x', anchor })).toEqual({
      ok: false,
      error: { code: 'invalid', message: "You can't comment on that line." },
    });
    notCalled();
  });

  it('unknown status → invalid', async () => {
    expect(await setThreadStatus(WS, '1', THREAD, { status: 'closed' })).toMatchObject({
      ok: false,
      error: { code: 'invalid' },
    });
    notCalled();
  });
});

describe('calling the API', () => {
  it('sends the trimmed body and returns the API response', async () => {
    api.postReply.mockResolvedValue({ ok: true, data: COMMENT_DATA });
    expect(await replyToThread(WS, '3', THREAD, { body: '  Hi  ' })).toEqual({
      ok: true,
      data: COMMENT_DATA,
    });
    expect(api.postReply).toHaveBeenCalledWith(WS, '3', THREAD, 'Hi');
  });

  it('passes a valid anchor through', async () => {
    api.postThread.mockResolvedValue({
      ok: false,
      status: 422,
      code: 'invalid_anchor',
      fieldErrors: {},
    });
    const anchor = { fileId: FILE, side: 'new', line: 4 };
    expect(await createThread(WS, '3', { body: 'Why?', anchor })).toEqual({
      ok: false,
      error: { code: 'invalid', message: "You can't comment on that line." },
    });
    expect(api.postThread).toHaveBeenCalledWith(WS, '3', { body: 'Why?', anchor });
  });

  it('maps API failures to typed errors', async () => {
    api.deleteCommentRequest.mockResolvedValue({
      ok: false,
      status: 404,
      code: 'comment_not_found',
      fieldErrors: {},
    });
    expect(await deleteComment(WS, '3', THREAD, COMMENT)).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: expect.stringContaining('deleted') },
    });
  });
});

describe('loadThreads', () => {
  it('returns the threads with a load time taken before the request', async () => {
    const before = new Date().toISOString();
    api.getThreads.mockResolvedValueOnce({ ok: true, data: [] });
    const result = await loadThreads(WS, '7');
    expect(api.getThreads).toHaveBeenCalledWith(WS, '7');
    expect(result.ok && result.data.threads).toEqual([]);
    expect(result.ok && result.data.loadedAt >= before).toBe(true);
  });

  it('rejects bad arguments without calling the API, and maps failures', async () => {
    api.getThreads.mockClear();
    expect(await loadThreads('nope', '7')).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(api.getThreads).not.toHaveBeenCalled();
    api.getThreads.mockResolvedValueOnce({ ok: false, status: 401 });
    expect(await loadThreads(WS, '7')).toMatchObject({
      ok: false,
      error: { code: 'unauthorized' },
    });
  });
});

describe('toCommentError', () => {
  it.each([
    [401, null, 'unauthorized'],
    [403, 'forbidden', 'forbidden'],
    [404, 'thread_not_found', 'not_found'],
    [404, 'comment_not_found', 'not_found'],
    [404, 'review_file_not_found', 'not_found'],
    [404, null, 'not_found'],
    [422, 'invalid_anchor', 'invalid'],
    [422, 'validation_error', 'invalid'],
    [500, null, 'failed'],
    [0, null, 'failed'],
    [409, 'conflict', 'failed'],
  ] as const)('%d %s → %s', (status, code, expected) => {
    const error = toCommentError({ status, code, fieldErrors: {} });
    expect(error.code).toBe(expected);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it('carries the body field error of a 422', () => {
    expect(
      toCommentError({
        status: 422,
        code: 'validation_error',
        fieldErrors: { body: 'Too small: expected string to have >=1 characters' },
      }),
    ).toEqual({
      code: 'invalid',
      message: 'Too small: expected string to have >=1 characters',
      bodyError: 'Too small: expected string to have >=1 characters',
    });
  });

  it('gives different messages for missing threads and comments', () => {
    const thread = toCommentError({ status: 404, code: 'thread_not_found', fieldErrors: {} });
    const comment = toCommentError({ status: 404, code: 'comment_not_found', fieldErrors: {} });
    expect(thread.message).not.toBe(comment.message);
  });
});
