import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatTimestamp, fullTimestamp, LocalTime } from './local-time';

const ISO = '2026-11-11T18:27:00.000Z';

describe('formatTimestamp', () => {
  it('formats in the given time zone', () => {
    expect(formatTimestamp(ISO, 'UTC')).toBe('Nov 11, 2026, 6:27 PM');
    expect(formatTimestamp(ISO, 'Asia/Kolkata')).toBe('Nov 11, 2026, 11:57 PM');
  });

  it('can roll over to the next local day', () => {
    expect(formatTimestamp('2026-11-11T20:00:00.000Z', 'UTC', true)).toBe('Nov 11, 2026');
    expect(formatTimestamp('2026-11-11T20:00:00.000Z', 'Asia/Kolkata', true)).toBe('Nov 12, 2026');
  });

  it('names the time zone in the full timestamp', () => {
    const full = fullTimestamp(ISO, 'Asia/Kolkata');
    expect(full).toContain('Wednesday, November 11, 2026');
    expect(full).toContain('11:57:00 PM');
    expect(full).toContain('(Asia/Kolkata)');
  });
});

describe('LocalTime', () => {
  it('renders a stable UTC fallback on the server', () => {
    const html = renderToStaticMarkup(<LocalTime iso={ISO} />);
    expect(html).toBe(
      `<time dateTime="${ISO}" title="${fullTimestamp(ISO, 'UTC')}">Nov 11, 2026, 6:27 PM UTC</time>`,
    );
    expect(renderToStaticMarkup(<LocalTime iso={ISO} />)).toBe(html);
  });

  it('renders a date-only fallback', () => {
    expect(renderToStaticMarkup(<LocalTime iso={ISO} dateOnly />)).toContain('>Nov 11, 2026 UTC<');
  });
});
