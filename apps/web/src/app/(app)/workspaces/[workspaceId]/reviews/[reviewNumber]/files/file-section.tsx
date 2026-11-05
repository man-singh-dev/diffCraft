'use client';

import type { ReviewFile } from '@diffcraft/shared';
import { useEffect, useState } from 'react';
import { useComments } from '@/components/comments-provider';
import { ChangeTypeBadge, filePath, LineCounts } from '@/components/review-ui';
import { smallSecondaryButton } from '@/components/styles';
import { fileSectionId } from '@/lib/diff-params';
import { onRevealFile } from '@/lib/reveal-file';

/** One file on the files page: a sticky header with a collapse button, and its diff. */
export function FileSection({ file, children }: { file: ReviewFile; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const comments = useComments();
  const openThreads =
    comments?.threads.filter((t) => t.anchor?.fileId === file.id && t.status === 'open').length ??
    0;
  const bodyId = `${fileSectionId(file.id)}-body`;

  useEffect(() => onRevealFile(file.id, () => setCollapsed(false)), [file.id]);

  return (
    <section
      id={fileSectionId(file.id)}
      aria-label={filePath(file)}
      className="scroll-mt-4 rounded-xl border border-slate-800 bg-slate-900"
    >
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-t-xl border-b border-slate-800 bg-slate-900/95 px-4 py-2 backdrop-blur">
        <ChangeTypeBadge changeType={file.changeType} />
        {file.isBinary && (
          <span className="rounded-full border border-amber-800 px-2 py-0.5 text-xs text-amber-300">
            binary
          </span>
        )}
        <h2 className="min-w-0 flex-1 break-all font-mono text-xs text-slate-200">
          {filePath(file)}
        </h2>
        {openThreads > 0 && (
          <span
            className="rounded-full border border-violet-800 bg-violet-950/60 px-2 py-0.5 text-xs text-violet-200"
            title="Open threads in this file"
          >
            {openThreads} open {openThreads === 1 ? 'thread' : 'threads'}
          </span>
        )}
        <LineCounts additions={file.additions} deletions={file.deletions} />
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((c) => !c)}
          className={smallSecondaryButton}
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </header>
      <div id={bodyId} hidden={collapsed} className="rounded-b-xl">
        {children}
      </div>
    </section>
  );
}
