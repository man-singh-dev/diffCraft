import type { AiAnalysisResult } from '@diffcraft/shared';
import type { AiProvider } from './types.js';

export const FAKE_MODEL = 'fake';

// No network: one finding on the first added line of each of the first three files, so the UI has real anchors.
export function createFakeProvider(): AiProvider {
  return {
    model: FAKE_MODEL,
    async analyze({ context }) {
      const findings: AiAnalysisResult['findings'] = [];
      for (const file of context.files.slice(0, 3)) {
        const line = file.hunks.flatMap((hunk) => hunk.lines).find((l) => l.type === 'add');
        if (!line?.newNumber) continue;
        findings.push({
          category: 'bug',
          severity: 'low',
          title: 'Example finding from the fake AI provider',
          explanation:
            'The fake provider marks the first added line of a file so findings can be tried without a model. Set AI_PROVIDER=openai_compatible for real analysis.',
          suggestion: null,
          file: file.path,
          side: 'new',
          lineStart: line.newNumber,
          lineEnd: line.newNumber,
          confidence: 0.5,
        });
      }
      const result: AiAnalysisResult = {
        summary: `Fake analysis of ${context.files.length} file(s).`,
        findings,
      };
      return { result, raw: JSON.stringify(result), usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}
