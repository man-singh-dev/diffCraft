export interface Segment {
  text: string;
  changed: boolean;
}

export interface WordDiff {
  old: Segment[];
  new: Segment[];
}

export const WORD_DIFF_MAX_TOKENS = 200;
export const WORD_DIFF_MAX_CHARS = 1_000;
export const WORD_DIFF_MIN_COMMON_RATIO = 0.4;

// \p{M} keeps combining accents (a decomposed "é") inside their word. No nested quantifiers, so matching is linear.
const TOKEN_RE = /[\p{L}\p{M}\p{N}_]+|\s+|[^]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

export function wholeLine(text: string, changed: boolean): Segment[] {
  return text === '' ? [] : [{ text, changed }];
}

function pushMerged(segments: Segment[], text: string, changed: boolean): void {
  const last = segments.at(-1);
  if (last && last.changed === changed) last.text += text;
  else segments.push({ text, changed });
}

export function diffWords(oldText: string, newText: string): WordDiff {
  const whole = { old: wholeLine(oldText, true), new: wholeLine(newText, true) };
  if (oldText.length > WORD_DIFF_MAX_CHARS || newText.length > WORD_DIFF_MAX_CHARS) return whole;

  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length > WORD_DIFF_MAX_TOKENS || b.length > WORD_DIFF_MAX_TOKENS) return whole;

  // lcs[i * width + j] = LCS length of a[i..] and b[j..].
  const width = b.length + 1;
  const lcs = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1]! + 1
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }

  const oldSegments: Segment[] = [];
  const newSegments: Segment[] = [];
  let commonChars = 0;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const tokenA = a[i];
    const tokenB = b[j];
    if (tokenA !== undefined && tokenA === tokenB) {
      pushMerged(oldSegments, tokenA, false);
      pushMerged(newSegments, tokenB, false);
      commonChars += tokenA.length * 2;
      i++;
      j++;
    } else if (
      tokenA !== undefined &&
      (tokenB === undefined || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)
    ) {
      pushMerged(oldSegments, tokenA, true);
      i++;
    } else if (tokenB !== undefined) {
      pushMerged(newSegments, tokenB, true);
      j++;
    }
  }

  const totalChars = oldText.length + newText.length;
  if (totalChars > 0 && commonChars / totalChars < WORD_DIFF_MIN_COMMON_RATIO) return whole;
  return { old: oldSegments, new: newSegments };
}
