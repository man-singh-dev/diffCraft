import type { Segment } from './diff-words.ts';

/** A syntax token: a piece of a line and its color (null = default text color). */
export interface ColorToken {
  text: string;
  color: string | null;
}

/** A piece of a line with both its syntax color and its word-diff flag. */
export interface Piece {
  text: string;
  color: string | null;
  changed: boolean;
}

const joined = (parts: { text: string }[]) => parts.map((p) => p.text).join('');

function push(pieces: Piece[], text: string, color: string | null, changed: boolean): void {
  if (text === '') return;
  const last = pieces.at(-1);
  if (last && last.color === color && last.changed === changed) last.text += text;
  else pieces.push({ text, color, changed });
}

/**
 * Overlays syntax tokens and word-diff segments of the same line, cutting at every boundary of
 * either. If they don't cover the same text (an upstream bug), returns the segments uncolored.
 */
export function mergePieces(tokens: ColorToken[], segments: Segment[]): Piece[] {
  const pieces: Piece[] = [];
  if (joined(tokens) !== joined(segments)) {
    for (const s of segments) push(pieces, s.text, null, s.changed);
    return pieces;
  }

  let ti = 0;
  let si = 0;
  // How far into the current token / segment we already are.
  let tOffset = 0;
  let sOffset = 0;
  while (ti < tokens.length && si < segments.length) {
    const token = tokens[ti]!;
    const segment = segments[si]!;
    const take = Math.min(token.text.length - tOffset, segment.text.length - sOffset);
    push(pieces, token.text.slice(tOffset, tOffset + take), token.color, segment.changed);
    tOffset += take;
    sOffset += take;
    if (tOffset === token.text.length) {
      ti++;
      tOffset = 0;
    }
    if (sOffset === segment.text.length) {
      si++;
      sOffset = 0;
    }
  }
  return pieces;
}
