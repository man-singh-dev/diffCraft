'use client';

import { parseCommentBody, type ThreadAnchor } from '@diffcraft/shared';
import { useState } from 'react';

const toolButton =
  'text-xs font-medium text-slate-400 hover:text-slate-100 focus-visible:outline-none focus-visible:underline';

export const NEW_SIDE_ONLY_NOTE = 'Suggestions only apply to lines on the new side';

const fenced = (lines: string[]) => ['```suggestion', ...lines, '```'].join('\n');

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2_000);
  }

  return (
    <button type="button" onClick={copy} className={toolButton}>
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

function SuggestionBox({
  originalLine,
  lines,
  downloadUrl,
}: {
  originalLine: string;
  lines: string[];
  downloadUrl: string;
}) {
  const row = 'flex min-h-5 whitespace-pre px-2 leading-5';
  const marker = 'w-4 shrink-0 select-none';
  return (
    <div className="overflow-hidden rounded-md border border-slate-700">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-700 bg-slate-800/60 px-2 py-1">
        <span className="text-xs font-semibold text-slate-300">Suggested change</span>
        <span className="ml-auto flex items-center gap-3">
          <CopyButton text={lines.join('\n')} />
          <a href={downloadUrl} download className={toolButton}>
            Download patch
          </a>
        </span>
      </div>
      <div className="overflow-x-auto py-1 font-mono text-xs">
        <div className={`${row} bg-red-950/50 text-red-200`}>
          <span className={marker} aria-hidden>
            -
          </span>
          <span>{originalLine}</span>
        </div>
        {lines.map((line, index) => (
          <div key={index} className={`${row} bg-emerald-950/50 text-emerald-200`}>
            <span className={marker} aria-hidden>
              +
            </span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CommentBody({
  body,
  anchor,
  downloadUrl,
}: {
  body: string;
  anchor: ThreadAnchor | null;
  downloadUrl: string;
}) {
  const parts = parseCommentBody(body);
  const applies = anchor?.side === 'new';
  // Plain text throughout: React escapes it, and line breaks are kept by CSS, not by markup.
  const text = 'whitespace-pre-wrap break-words text-sm text-slate-200';

  return (
    <div className="space-y-2">
      {parts.map((part, index) =>
        part.type === 'text' ? (
          <p key={index} className={text}>
            {part.text}
          </p>
        ) : applies ? (
          <SuggestionBox
            key={index}
            originalLine={anchor.lineContent}
            lines={part.lines}
            downloadUrl={downloadUrl}
          />
        ) : (
          <div key={index} className="space-y-1">
            <p className={text}>{fenced(part.lines)}</p>
            <p className="text-xs text-slate-500">{NEW_SIDE_ONLY_NOTE}</p>
          </div>
        ),
      )}
    </div>
  );
}
