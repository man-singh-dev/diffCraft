import {
  anchorForLine,
  lineAnchor,
  type GapRow,
  type HunkRow,
  type Piece,
} from '@diffcraft/shared';
import type {
  DiffRows,
  HighlightedSplitCell,
  HighlightedSplitLineRow,
  HighlightedUnifiedLineRow,
} from '@/lib/diff-view.server';
import { threadKey, unifiedRowKeys, unifiedRowTarget } from '@/lib/thread-anchors';
import { AddCommentButton, SplitThreadsRow, UnifiedThreadsRow } from './line-comments';

// No hooks or 'use client', so server pages and the client "Load diff" button can both render it. Pieces render as text, which React escapes.

type LineType = HighlightedUnifiedLineRow['type'];

const LINE_BG: Record<LineType, string> = {
  context: '',
  add: 'bg-emerald-500/10',
  del: 'bg-red-500/10',
};
const NUMBER_BG: Record<LineType, string> = {
  context: '',
  add: 'bg-emerald-500/15',
  del: 'bg-red-500/15',
};
const CHANGED_BG: Record<LineType, string> = {
  context: '',
  add: 'bg-emerald-400/30',
  del: 'bg-red-400/35',
};
const MARKER: Record<LineType, string> = { context: ' ', add: '+', del: '−' };
const SR_LABEL: Record<LineType, string | null> = {
  context: null,
  add: 'added line',
  del: 'removed line',
};

const numberCell =
  'w-[1%] min-w-12 select-none whitespace-nowrap px-2 text-right align-top font-mono text-xs leading-5 text-slate-500';
const numberLink = 'hover:text-slate-200 focus-visible:outline-none focus-visible:underline';
const markerCell =
  'relative w-5 select-none px-1 text-center align-top font-mono text-xs leading-5';
const codeCell = 'h-5 whitespace-pre pr-4 align-top font-mono text-xs leading-5 [tab-size:4]';
const emptyCell = 'bg-slate-950/70';
// :target highlight of a linked line. Written out in full so Tailwind sees each class.
const GROUP_TARGET = 'group-target:bg-yellow-400/20';
const SELF_TARGET = 'target:bg-yellow-400/20';

// Only on a real word-level diff: a line changed as a whole already has its line background.
export function hasWordDiff(pieces: Piece[]): boolean {
  return pieces.some((p) => p.changed) && pieces.some((p) => !p.changed);
}

function Pieces({ pieces, type }: { pieces: Piece[]; type: LineType }) {
  const emphasise = type !== 'context' && hasWordDiff(pieces);
  return pieces.map((piece, i) => (
    <span
      key={i}
      style={piece.color ? { color: piece.color } : undefined}
      className={emphasise && piece.changed ? `rounded-sm ${CHANGED_BG[type]}` : undefined}
    >
      {piece.text}
    </span>
  ));
}

function NoNewline() {
  return (
    <span className="ml-2 select-none text-[10px] text-slate-500">No newline at end of file</span>
  );
}

function Code({
  type,
  pieces,
  noNewlineAtEnd,
}: {
  type: LineType;
  pieces: Piece[];
  noNewlineAtEnd: boolean;
}) {
  const label = SR_LABEL[type];
  return (
    <>
      {label && <span className="sr-only">{label}: </span>}
      <Pieces pieces={pieces} type={type} />
      {noNewlineAtEnd && <NoNewline />}
    </>
  );
}

function NumberLink({ anchor, number, id }: { anchor: string; number: number; id?: string }) {
  return (
    <a id={id} href={`#${anchor}`} className={id ? `${numberLink} scroll-mt-14` : numberLink}>
      {number}
    </a>
  );
}

function Marker({ type }: { type: LineType }) {
  return <span aria-hidden="true">{MARKER[type]}</span>;
}

function HunkHeader({ row, colSpan }: { row: HunkRow; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="whitespace-pre bg-indigo-950/40 px-3 py-1 font-mono text-xs leading-5 text-slate-400"
      >
        {row.header}
      </td>
    </tr>
  );
}

function Gap({ row, colSpan }: { row: GapRow; colSpan: number }) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="select-none bg-slate-900/80 px-3 py-1 text-xs leading-5 text-slate-500"
      >
        ⋯ {row.hiddenLines} {row.hiddenLines === 1 ? 'line' : 'lines'} hidden
      </td>
    </tr>
  );
}

function UnifiedLine({ fileId, row }: { fileId: string; row: HighlightedUnifiedLineRow }) {
  const anchor = anchorForLine(fileId, row);
  const target = unifiedRowTarget(fileId, row);
  const numberClass = `${numberCell} ${NUMBER_BG[row.type]} ${GROUP_TARGET}`;
  // The old number also gets an id, so a link to the old side (e.g. a split-view thread) finds the row.
  const oldId =
    row.type === 'context' && row.oldNumber !== null
      ? lineAnchor(fileId, 'old', row.oldNumber)
      : undefined;
  return (
    <>
      <tr
        id={anchor}
        className={`group scroll-mt-14 ${LINE_BG[row.type]} has-[:target]:bg-yellow-400/20`}
      >
        <td className={numberClass}>
          {row.oldNumber !== null && (
            <NumberLink anchor={oldId ?? anchor} number={row.oldNumber} id={oldId} />
          )}
        </td>
        <td className={numberClass}>
          {row.newNumber !== null && <NumberLink anchor={anchor} number={row.newNumber} />}
        </td>
        <td className={`${markerCell} ${GROUP_TARGET}`}>
          <Marker type={row.type} />
          {target && <AddCommentButton target={target} className="group-hover:opacity-100" />}
        </td>
        <td className={`${codeCell} ${GROUP_TARGET}`}>
          <Code type={row.type} pieces={row.pieces} noNewlineAtEnd={row.noNewlineAtEnd} />
        </td>
      </tr>
      <UnifiedThreadsRow keys={unifiedRowKeys(fileId, row)} target={target} colSpan={4} />
    </>
  );
}

// Each half has its own anchor, so the id goes on the half's number cell and the next two cells follow it via a named peer.
const SPLIT_HALF = {
  old: { peer: 'peer/old', follow: 'peer-target/old:bg-yellow-400/20' },
  new: { peer: 'peer/new', follow: 'peer-target/new:bg-yellow-400/20' },
};

function SplitHalf({
  fileId,
  cell,
  side,
}: {
  fileId: string;
  cell: HighlightedSplitCell | null;
  side: 'old' | 'new';
}) {
  if (!cell) {
    return (
      <>
        <td className={`${numberCell} ${emptyCell}`} />
        <td className={`${markerCell} ${emptyCell}`} />
        <td className={`${codeCell} ${emptyCell}`} />
      </>
    );
  }
  const half = SPLIT_HALF[side];
  const anchor = lineAnchor(fileId, side, cell.number);
  const bg = LINE_BG[cell.type];
  return (
    <>
      <td
        id={anchor}
        className={`${half.peer} scroll-mt-14 ${numberCell} ${NUMBER_BG[cell.type]} ${SELF_TARGET}`}
      >
        <NumberLink anchor={anchor} number={cell.number} />
      </td>
      <td className={`${markerCell} ${bg} ${half.follow}`}>
        <Marker type={cell.type} />
        <AddCommentButton
          target={{ fileId, side, line: cell.number }}
          className="group-hover:opacity-100"
        />
      </td>
      <td className={`${codeCell} w-1/2 ${bg} ${half.follow}`}>
        <Code type={cell.type} pieces={cell.pieces} noNewlineAtEnd={cell.noNewlineAtEnd} />
      </td>
    </>
  );
}

const splitSide = (fileId: string, side: 'old' | 'new', cell: HighlightedSplitCell | null) =>
  cell && {
    keys: [threadKey(fileId, side, cell.number)],
    target: { fileId, side, line: cell.number },
  };

function SplitLine({ fileId, row }: { fileId: string; row: HighlightedSplitLineRow }) {
  return (
    <>
      <tr className="group">
        <SplitHalf fileId={fileId} cell={row.left} side="old" />
        <SplitHalf fileId={fileId} cell={row.right} side="new" />
      </tr>
      <SplitThreadsRow
        left={splitSide(fileId, 'old', row.left)}
        right={splitSide(fileId, 'new', row.right)}
        halfSpan={3}
      />
    </>
  );
}

export function DiffTable({ fileId, diff }: { fileId: string; diff: DiffRows }) {
  const colSpan = diff.view === 'split' ? 6 : 4;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-slate-200">
        <caption className="sr-only">
          {diff.view === 'split' ? 'Side-by-side diff' : 'Unified diff'}
        </caption>
        <tbody>
          {diff.view === 'split'
            ? diff.rows.map((row) =>
                row.kind === 'hunk' ? (
                  <HunkHeader key={row.key} row={row} colSpan={colSpan} />
                ) : row.kind === 'gap' ? (
                  <Gap key={row.key} row={row} colSpan={colSpan} />
                ) : (
                  <SplitLine key={row.key} fileId={fileId} row={row} />
                ),
              )
            : diff.rows.map((row) =>
                row.kind === 'hunk' ? (
                  <HunkHeader key={row.key} row={row} colSpan={colSpan} />
                ) : row.kind === 'gap' ? (
                  <Gap key={row.key} row={row} colSpan={colSpan} />
                ) : (
                  <UnifiedLine key={row.key} fileId={fileId} row={row} />
                ),
              )}
        </tbody>
      </table>
    </div>
  );
}
