import { parsePatch, type Comment, type Thread, type WorkspaceRole } from '@diffcraft/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The provider imports the Server Actions; these tests only render.
vi.mock('@/lib/comment-actions', () => ({
  createThread: vi.fn(),
  replyToThread: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  setThreadStatus: vi.fn(),
}));
vi.mock('server-only', () => ({}));

const { CommentsProvider } = await import('./comments-provider.js');
const { CommentThread } = await import('./comment-thread.js');
const { DiffTable } = await import('./diff-table.js');
const { highlightedRows } = await import('../lib/diff-view.server.js');

const WS = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const FILE = '01a17e5e-aa56-7985-be46-bf5f1c7e7fd2';
const AUTHOR = '01a17e5e-aa56-7985-be46-bf5f1c7e7f01';
const OTHER = '01a17e5e-aa56-7985-be46-bf5f1c7e7f02';
const REVIEW_AUTHOR = '01a17e5e-aa56-7985-be46-bf5f1c7e7f03';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: id(),
    threadId: 'set below',
    author: { id: AUTHOR, displayName: 'Ada' },
    body: 'Looks good',
    createdAt: '2026-11-05T10:00:00.000Z',
    edited: false,
    deleted: false,
    ...overrides,
  };
}

function makeThread(comments: Comment[], overrides: Partial<Thread> = {}): Thread {
  const threadId = id();
  return {
    id: threadId,
    reviewId: WS,
    anchor: null,
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    createdBy: { id: AUTHOR, displayName: 'Ada' },
    createdAt: '2026-11-05T10:00:00.000Z',
    comments: comments.map((c) => ({ ...c, threadId })),
    ...overrides,
  };
}

function render(node: React.ReactNode, threads: Thread[], userId: string, role: WorkspaceRole) {
  return renderToStaticMarkup(
    <CommentsProvider
      workspaceId={WS}
      reviewNumber="1"
      viewer={{ userId, role }}
      reviewAuthorId={REVIEW_AUTHOR}
      initialThreads={threads}
    >
      {node}
    </CommentsProvider>,
  );
}

const renderThread = (thread: Thread, userId: string, role: WorkspaceRole) =>
  render(<CommentThread thread={thread} />, [thread], userId, role);

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe('CommentThread', () => {
  it('renders a body with HTML as text', () => {
    const thread = makeThread([comment({ body: '<img src=x onerror=alert(1)>\nsecond line' })]);
    const html = renderThread(thread, AUTHOR, 'member');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;\nsecond line');
    expect(html).toContain('whitespace-pre-wrap');
  });

  it('shows author, date, (edited), the deleted placeholder and "Deleted user"', () => {
    const thread = makeThread([
      comment({ edited: true }),
      comment({ deleted: true, body: '' }),
      comment({ author: null, body: 'From a deleted account' }),
    ]);
    const html = renderThread(thread, OTHER, 'member');
    expect(html).toContain('Ada');
    expect(html).toContain('<time dateTime="2026-11-05T10:00:00.000Z">Nov 5, 2026</time>');
    expect(html.match(/\(edited\)/g)).toHaveLength(1);
    expect(html).toContain('This comment was deleted.');
    expect(html).toContain('Deleted user');
    expect(html).toContain(`id="thread-${thread.id}"`);
  });

  it.each([
    ['the author (member)', AUTHOR, 'member', ['Edit', 'Delete', 'Reply', 'Resolve']],
    ['another member', OTHER, 'member', ['Reply']],
    ['the review author (member)', REVIEW_AUTHOR, 'member', ['Reply', 'Resolve']],
    ['an admin', OTHER, 'admin', ['Delete', 'Reply', 'Resolve']],
    ['the owner', OTHER, 'owner', ['Delete', 'Reply', 'Resolve']],
    ['a viewer', OTHER, 'viewer', []],
    ['the author, demoted to viewer', AUTHOR, 'viewer', ['Edit']],
  ] as const)('buttons for %s', (_name, userId, role, expected) => {
    const html = renderThread(makeThread([comment()]), userId, role);
    expect(buttons(html)).toEqual(expected);
  });

  it('a deleted comment has no Edit or Delete, even for its author', () => {
    const html = renderThread(makeThread([comment({ deleted: true, body: '' })]), AUTHOR, 'admin');
    expect(buttons(html)).toEqual(['Reply', 'Resolve']);
  });

  it('a resolved thread is collapsed to one line', () => {
    const thread = makeThread([comment(), comment(), comment({ body: 'third' })], {
      status: 'resolved',
      resolvedBy: { id: OTHER, displayName: 'Grace' },
      resolvedAt: '2026-11-05T11:00:00.000Z',
    });
    const html = renderThread(thread, AUTHOR, 'member');
    expect(html).toContain('Resolved thread · 3 comments');
    expect(buttons(html)).toEqual(['Show']);
    expect(html).not.toContain('third');
  });
});

describe('line threads in DiffTable', () => {
  const patch = [
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,3 +1,3 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    ' const c = 4;',
    '',
  ].join('\n');
  const hunks = parsePatch(patch).files[0]!.hunks;
  const lineThread = (side: 'old' | 'new', line: number, body: string) =>
    makeThread([comment({ body })], { anchor: { fileId: FILE, side, line, lineContent: 'x' } });

  async function renderDiff(view: 'unified' | 'split', threads: Thread[], role: WorkspaceRole) {
    const diff = await highlightedRows('a.ts', hunks, view);
    return render(<DiffTable fileId={FILE} diff={diff} />, threads, OTHER, role);
  }

  it('shows "+" buttons for members, not viewers', async () => {
    const member = await renderDiff('unified', [], 'member');
    expect(member).toContain('aria-label="Add a comment on line 2"');
    expect(member.match(/aria-label="Add a comment on line/g)).toHaveLength(4);
    const viewer = await renderDiff('unified', [], 'viewer');
    expect(viewer).not.toContain('Add a comment');
  });

  it('unified: a thread appears in a row right under its line; context rows match both sides', async () => {
    const threads = [
      lineThread('old', 2, 'on the removed line'),
      lineThread('new', 2, 'on the added line'),
      lineThread('old', 3, 'old side of a context line'),
    ];
    const html = await renderDiff('unified', threads, 'member');
    const rows = html.split('<tr').slice(1);
    const under = (anchor: string) =>
      rows[rows.findIndex((r) => r.includes(`id="${anchor}"`)) + 1]!;

    expect(under(`f-${FILE}-L2`)).toContain('on the removed line');
    expect(under(`f-${FILE}-R2`)).toContain('on the added line');
    expect(under(`f-${FILE}-R3`)).toContain('old side of a context line');
  });

  it('split: each side’s threads sit under its own half', async () => {
    const threads = [lineThread('old', 2, 'left side'), lineThread('new', 2, 'right side')];
    const html = await renderDiff('split', threads, 'member');
    const rows = html.split('<tr').slice(1);
    const index = rows.findIndex((r) => r.includes(`id="f-${FILE}-L2"`));
    const [left, right] = rows[index + 1]!.split('<td').slice(1);
    expect(left).toContain('left side');
    expect(left).not.toContain('right side');
    expect(right).toContain('right side');
  });

  it('without a provider, no comment controls are rendered', async () => {
    const diff = await highlightedRows('a.ts', hunks, 'unified');
    const html = renderToStaticMarkup(<DiffTable fileId={FILE} diff={diff} />);
    expect(html).not.toContain('Add a comment');
  });
});
