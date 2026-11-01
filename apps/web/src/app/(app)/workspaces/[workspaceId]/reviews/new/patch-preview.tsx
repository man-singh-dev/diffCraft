'use client';

import { DiffParseError, parsePatch, type DiffFile } from '@diffcraft/shared';
import { useEffect, useState } from 'react';
import { ChangeTypeBadge, filePath, LineCounts } from '@/components/review-ui';
import { describePatchError } from '@/lib/review-errors';

const DEBOUNCE_MS = 300;
const SHOWN_FILES = 20;

type Preview =
  | { kind: 'empty' }
  | { kind: 'parsed'; files: DiffFile[]; additions: number; deletions: number }
  | { kind: 'error'; message: string };

function preview(patch: string): Preview {
  if (patch.trim() === '') return { kind: 'empty' };
  try {
    const { files } = parsePatch(patch);
    return {
      kind: 'parsed',
      files,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    };
  } catch (error) {
    if (error instanceof DiffParseError) {
      return { kind: 'error', message: describePatchError(error.code, error.line) };
    }
    return { kind: 'error', message: "The patch couldn't be read." };
  }
}

/** What the server will make of the patch. Only a hint: the server parses it again. */
export function PatchPreview({ patch }: { patch: string }) {
  const [result, setResult] = useState<Preview>({ kind: 'empty' });

  useEffect(() => {
    const timer = setTimeout(() => setResult(preview(patch)), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [patch]);

  if (result.kind === 'empty') return null;

  return (
    <section
      aria-label="Patch preview"
      aria-live="polite"
      className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-sm"
    >
      {result.kind === 'error' ? (
        <p className="text-red-400">{result.message}</p>
      ) : (
        <>
          <p className="text-slate-200">
            {result.files.length} {result.files.length === 1 ? 'file' : 'files'} ·{' '}
            <LineCounts additions={result.additions} deletions={result.deletions} />
          </p>
          <ul className="space-y-1">
            {result.files.slice(0, SHOWN_FILES).map((file, index) => (
              <li key={index} className="flex items-center gap-2">
                <ChangeTypeBadge changeType={file.changeType} />
                <span className="min-w-0 truncate font-mono text-xs text-slate-300">
                  {filePath(file)}
                </span>
              </li>
            ))}
          </ul>
          {result.files.length > SHOWN_FILES && (
            <p className="text-xs text-slate-500">and {result.files.length - SHOWN_FILES} more</p>
          )}
        </>
      )}
    </section>
  );
}
