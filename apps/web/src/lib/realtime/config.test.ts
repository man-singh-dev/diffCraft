import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRealtimeUrl, warnIfRealtimeDisabled } from './config';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseRealtimeUrl', () => {
  it.each([
    ['http://localhost:4000', 'http://localhost:4000'],
    ['https://diffcraft-api.onrender.com/', 'https://diffcraft-api.onrender.com'],
    ['  https://api.example.com  ', 'https://api.example.com'],
  ])('accepts %j', (raw, url) => {
    expect(parseRealtimeUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([undefined, '', '   '])('treats %j as missing', (raw) => {
    expect(parseRealtimeUrl(raw)).toEqual({ ok: false, reason: 'missing' });
  });

  it.each([
    'localhost:4000',
    'not a url',
    'ws://localhost:4000',
    'ftp://example.com',
    'http://localhost:4000/api',
    'http://localhost:4000/?x=1',
    'http://user:pw@localhost:4000',
  ])('rejects %j', (raw) => {
    expect(parseRealtimeUrl(raw)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('warnIfRealtimeDisabled', () => {
  it('warns once, about a missing URL only in development', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnIfRealtimeDisabled({ ok: true, url: 'http://localhost:4000' }, true);
    expect(warn).not.toHaveBeenCalled();
    warnIfRealtimeDisabled({ ok: false, reason: 'missing' }, true);
    warnIfRealtimeDisabled({ ok: false, reason: 'missing' }, true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
