import type { AiFindingOutput, DiffSide } from '@diffcraft/shared';
import type { AnalyzedFile } from './context.js';

export interface MappedFinding {
  reviewFileId: string;
  side: DiffSide;
  lineStart: number;
  lineEnd: number;
  category: AiFindingOutput['category'];
  severity: AiFindingOutput['severity'];
  title: string;
  explanation: string;
  suggestion: string | null;
  confidence: number;
}

interface FileLines {
  file: AnalyzedFile;
  hunks: Record<DiffSide, Set<number>>[];
}

const normalizePath = (path: string) => path.trim().replace(/^(?:\.\/|[ab]\/|\/)/, '');

function indexFiles(files: readonly AnalyzedFile[]): Map<string, FileLines> {
  const byPath = new Map<string, FileLines>();
  for (const file of files) {
    const entry: FileLines = {
      file,
      hunks: file.hunks.map((hunk) => ({
        new: new Set(hunk.lines.flatMap((l) => (l.newNumber === null ? [] : [l.newNumber]))),
        old: new Set(hunk.lines.flatMap((l) => (l.oldNumber === null ? [] : [l.oldNumber]))),
      })),
    };
    for (const path of [file.path, file.newPath, file.oldPath]) {
      if (path && !byPath.has(path)) byPath.set(path, entry);
    }
  }
  return byPath;
}

// The model's line references are untrusted: a finding survives only if its whole range is inside one hunk of an analyzed file.
export function mapFindings(
  findings: readonly AiFindingOutput[],
  files: readonly AnalyzedFile[],
): { mapped: MappedFinding[]; dropped: number } {
  const byPath = indexFiles(files);
  const mapped: MappedFinding[] = [];
  for (const finding of findings) {
    const entry = finding.file
      ? (byPath.get(finding.file.trim()) ?? byPath.get(normalizePath(finding.file)))
      : undefined;
    const lineStart = finding.lineStart;
    if (!entry || !lineStart) continue;
    const lineEnd = finding.lineEnd ?? lineStart;
    if (lineEnd < lineStart) continue;
    const side: DiffSide =
      finding.side ?? (entry.hunks.some((h) => h.new.has(lineStart)) ? 'new' : 'old');
    const inOneHunk = entry.hunks.some((h) => h[side].has(lineStart) && h[side].has(lineEnd));
    if (!inOneHunk) continue;
    mapped.push({
      reviewFileId: entry.file.id,
      side,
      lineStart,
      lineEnd,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      explanation: finding.explanation,
      suggestion: finding.suggestion || null,
      confidence: finding.confidence,
    });
  }
  return { mapped, dropped: findings.length - mapped.length };
}
