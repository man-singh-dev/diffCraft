import { z } from 'zod';
import type { DiffLine } from '../schemas.ts';

export type LineSide = 'old' | 'new';

export interface LineAnchor {
  fileId: string;
  side: LineSide;
  number: number;
}

const INT4_MAX = 2_147_483_647;
const ANCHOR_RE = /^f-([0-9a-fA-F-]{36})-([LR])([1-9][0-9]{0,9})$/;
const uuid = z.uuid();

/** URL fragment for a line: "f-<fileId>-L12" (old side) or "f-<fileId>-R12" (new side). */
export function lineAnchor(fileId: string, side: LineSide, number: number): string {
  return `f-${fileId}-${side === 'old' ? 'L' : 'R'}${number}`;
}

/** Parses an anchor made by lineAnchor; null for anything else. */
export function parseLineAnchor(anchor: string): LineAnchor | null {
  const match = ANCHOR_RE.exec(anchor);
  if (!match) return null;
  const [, fileId, letter, digits] = match;
  const number = Number(digits);
  if (!uuid.safeParse(fileId).success || number > INT4_MAX) return null;
  return { fileId: fileId!, side: letter === 'L' ? 'old' : 'new', number };
}

/** Deleted lines are anchored on the old side; context and added lines on the new side. */
export function anchorForLine(fileId: string, line: DiffLine): string {
  const side: LineSide = line.type === 'del' ? 'old' : 'new';
  const number = side === 'old' ? line.oldNumber : line.newNumber;
  if (number === null) throw new Error(`diff line has no ${side} number`);
  return lineAnchor(fileId, side, number);
}
