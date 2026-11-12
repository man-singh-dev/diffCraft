import { describe, expect, it } from 'vitest';
import { AI_MAX_FINDINGS, AiAnalysisResultSchema, AiFindingSchema } from './ai.ts';

const finding = {
  category: 'bug',
  severity: 'high',
  title: 'Off by one',
  explanation: 'The loop skips the last element.',
  file: 'src/a.ts',
  side: 'new',
  lineStart: 3,
  lineEnd: 4,
  confidence: 0.8,
};

describe('AiFindingSchema', () => {
  it('accepts a finding with optional fields missing or null', () => {
    expect(AiFindingSchema.safeParse(finding).success).toBe(true);
    expect(
      AiFindingSchema.safeParse({ ...finding, file: null, side: null, suggestion: null }).success,
    ).toBe(true);
    const bare = {
      ...finding,
      file: undefined,
      side: undefined,
      lineStart: undefined,
      lineEnd: undefined,
    };
    expect(AiFindingSchema.safeParse(bare).success).toBe(true);
  });

  it.each([
    ['an unknown category', { category: 'style' }],
    ['an unknown severity', { severity: 'urgent' }],
    ['an empty title', { title: '  ' }],
    ['a long title', { title: 'x'.repeat(201) }],
    ['a long explanation', { explanation: 'x'.repeat(4001) }],
    ['confidence above 1', { confidence: 1.5 }],
    ['a zero line', { lineStart: 0 }],
    ['a fractional line', { lineEnd: 2.5 }],
    ['an unknown side', { side: 'both' }],
  ])('rejects %s', (_name, override) => {
    expect(AiFindingSchema.safeParse({ ...finding, ...override }).success).toBe(false);
  });
});

describe('AiAnalysisResultSchema', () => {
  it('accepts an empty findings array', () => {
    expect(AiAnalysisResultSchema.safeParse({ summary: 'Looks fine.', findings: [] }).success).toBe(
      true,
    );
  });

  it('limits the number of findings', () => {
    const findings = Array.from({ length: AI_MAX_FINDINGS + 1 }, () => finding);
    expect(AiAnalysisResultSchema.safeParse({ summary: '', findings }).success).toBe(false);
  });
});
