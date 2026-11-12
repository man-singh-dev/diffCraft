import {
  parsePatch,
  type AiFinding,
  type AiJob,
  type LatestAnalysisResponse,
  type WorkspaceRole,
} from '@diffcraft/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AI_FILE, aiFinding, aiJob } from '@/lib/ai-fixture';

// The providers import the Server Actions; these tests only render.
vi.mock('@/lib/comment-actions', () => ({
  createThread: vi.fn(),
  replyToThread: vi.fn(),
  editComment: vi.fn(),
  deleteComment: vi.fn(),
  setThreadStatus: vi.fn(),
  loadThreads: vi.fn(),
}));
vi.mock('@/lib/ai-actions', () => ({
  runAnalysis: vi.fn(),
  loadLatestAnalysis: vi.fn(),
  dismissFinding: vi.fn(),
  setFindingFeedback: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { CommentsProvider } = await import('./comments-provider.js');
const { AiAnalysisProvider } = await import('./ai-analysis-provider.js');
const { AiReviewCard, AiFindingsToggle, RunErrorMessage, statusText } =
  await import('./ai-review-card.js');
const { DiffTable } = await import('./diff-table.js');
const { highlightedRows } = await import('../lib/diff-view.server.js');

const WS = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const USER = '01a17e5e-aa56-7985-be46-bf5f1c7e7f01';

interface RenderOptions {
  role?: WorkspaceRole;
  reviewOpen?: boolean;
}

function render(
  node: React.ReactNode,
  latest: LatestAnalysisResponse | null,
  { role = 'member', reviewOpen = true }: RenderOptions = {},
) {
  return renderToStaticMarkup(
    <CommentsProvider
      workspaceId={WS}
      reviewNumber="1"
      viewer={{ userId: USER, role }}
      reviewAuthorId={null}
      initialThreads={[]}
      loadedAt="2026-11-12T10:00:00.000Z"
    >
      <AiAnalysisProvider
        workspaceId={WS}
        reviewNumber="1"
        initial={latest}
        loadedAt="2026-11-12T10:00:00.000Z"
        reviewOpen={reviewOpen}
      >
        {node}
      </AiAnalysisProvider>
    </CommentsProvider>,
  );
}

const card = (
  job: AiJob | null,
  findings: AiFinding[] = [],
  options?: RenderOptions & { enabled?: boolean },
) => render(<AiReviewCard />, { enabled: options?.enabled ?? true, job, findings }, options);

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');

const runButton = (html: string) => html.match(/<button[^>]*>(Run AI review|Run again|Try again)/);

describe('AiReviewCard states', () => {
  it('idle: explains the feature and offers to run it, labeled as AI', () => {
    const html = card(null);
    expect(text(html)).toContain('AI-generated and may be wrong.');
    expect(html).toContain('>AI</span>');
    expect(runButton(html)?.[0]).not.toContain('disabled=""');
    expect(html).toContain('No AI review yet.');
  });

  it('queued: waiting, with the button disabled', () => {
    const html = card(aiJob({ status: 'queued', finishedAt: null }));
    expect(text(html)).toContain('Waiting…');
    expect(runButton(html)?.[0]).toContain('disabled=""');
    expect(html).toMatch(/role="status"[^>]*>AI review waiting to start\./);
  });

  it('running: analyzing with a spinner, button disabled', () => {
    const html = card(aiJob({ status: 'running', finishedAt: null }));
    expect(text(html)).toContain('Analyzing…');
    expect(html).toContain('animate-spin');
    expect(runButton(html)?.[0]).toContain('disabled=""');
  });

  it('succeeded: summary, counts by severity, model and time', () => {
    const html = card(aiJob({ summary: 'Adds a cache.' }), [
      aiFinding({ severity: 'high' }),
      aiFinding({ severity: 'low' }),
      aiFinding({ severity: 'low' }),
    ]);
    const t = text(html);
    expect(t).toContain('Adds a cache.');
    expect(t).toContain('3 findings: 1 high · 2 low');
    expect(t).toContain('gpt-oss-120b');
    expect(html).toContain('<time dateTime="2026-11-12T10:00:30.000Z"');
    expect(runButton(html)?.[1]).toBe('Run again');
  });

  it('failed: a friendly message for the error code and Try again', () => {
    const html = card(aiJob({ status: 'failed', errorCode: 'provider_timeout' }));
    expect(text(html)).toContain('The analysis took too long and was stopped.');
    expect(html.match(/>Try again</g)).toHaveLength(2);
  });

  it('hides the run button when AI is disabled, and for viewers', () => {
    expect(runButton(card(aiJob(), [aiFinding()], { enabled: false }))).toBeNull();
    expect(runButton(card(null, [], { role: 'viewer' }))).toBeNull();
  });

  it('renders nothing when AI is disabled and was never used', () => {
    expect(card(null, [], { enabled: false })).toBe('');
  });

  it('disables the run button for a review that is not open', () => {
    const html = card(null, [], { reviewOpen: false });
    expect(runButton(html)?.[0]).toContain('disabled=""');
    expect(text(html)).toContain('Only open reviews can be analyzed.');
  });

  it('marks findings that come from an earlier run', () => {
    const html = card(aiJob({ id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f39', status: 'queued' }), [
      aiFinding(),
    ]);
    expect(text(html)).toContain('From the previous run:');
  });

  it('statusText describes every status for the live region', () => {
    expect(statusText(aiJob({ status: 'succeeded' }), 1)).toBe(
      'AI review finished with 1 finding.',
    );
    expect(statusText(aiJob({ status: 'failed' }), 0)).toBe('AI review failed.');
  });
});

describe('findings in the card', () => {
  it('groups from critical to info, with category, location link and confidence', () => {
    const html = card(aiJob(), [
      aiFinding({ severity: 'low', title: 'Low one' }),
      aiFinding({ severity: 'critical', title: 'Critical one', category: 'security' }),
    ]);
    expect(html.indexOf('Critical one')).toBeLessThan(html.indexOf('Low one'));
    expect(html).toContain('>security</span>');
    expect(html).toContain(`href="/workspaces/${WS}/reviews/1/files#f-${AI_FILE}-R2"`);
    expect(text(html)).toContain('Confidence 80%');
  });

  it('shows the suggestion as a code block', () => {
    const html = card(aiJob(), [aiFinding({ suggestion: 'items.length' })]);
    expect(html).toContain('<code>items.length</code>');
  });

  it('shows feedback toggles with aria-pressed, and dismiss / start thread', () => {
    const html = card(aiJob(), [
      aiFinding({ myFeedback: true, feedback: { helpful: 2, notHelpful: 1 } }),
    ]);
    expect(html).toMatch(/aria-pressed="true" aria-label="Helpful \(2\)"/);
    expect(html).toMatch(/aria-pressed="false" aria-label="Not helpful \(1\)"/);
    expect(html).toContain('aria-label="Dismiss finding: Off by one"');
    expect(html).toContain('>Start thread<');
  });

  it('shows no actions to viewers', () => {
    const html = card(aiJob(), [aiFinding()], { role: 'viewer' });
    expect(html).toContain('Off by one');
    expect(html).not.toContain('Dismiss');
    expect(html).not.toContain('aria-pressed');
  });
});

it('RunErrorMessage says when the workspace can run again (429)', () => {
  const html = renderToStaticMarkup(
    <RunErrorMessage
      error={{ code: 'rate_limited', message: 'Used up.', retryAfterSeconds: 3600 }}
      availableAt="2026-11-12T11:00:00.000Z"
    />,
  );
  expect(html).toContain('role="alert"');
  expect(text(html)).toContain('Used up. Available again Nov 12, 2026, 11:00 AM UTC .');
});

describe('inline findings in DiffTable', () => {
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

  async function renderDiff(view: 'unified' | 'split', findings: AiFinding[]) {
    const diff = await highlightedRows('a.ts', hunks, view);
    return render(<DiffTable fileId={AI_FILE} diff={diff} />, {
      enabled: true,
      job: aiJob(),
      findings,
    });
  }

  it('unified: a finding sits right under its line, on its side', async () => {
    const html = await renderDiff('unified', [
      aiFinding({ side: 'old', lineStart: 2, title: 'On the removed line' }),
      aiFinding({ side: 'new', lineStart: 2, title: 'On the added line' }),
    ]);
    const rows = html.split('<tr').slice(1);
    const under = (anchor: string) =>
      rows[rows.findIndex((r) => r.includes(`id="${anchor}"`)) + 1]!;
    expect(under(`f-${AI_FILE}-L2`)).toContain('On the removed line');
    expect(under(`f-${AI_FILE}-L2`)).not.toContain('On the added line');
    expect(under(`f-${AI_FILE}-R2`)).toContain('On the added line');
    expect(html).toContain('>AI</span>');
  });

  it('split: findings sit under their own half', async () => {
    const html = await renderDiff('split', [
      aiFinding({ side: 'old', lineStart: 2, title: 'Left' }),
      aiFinding({ side: 'new', lineStart: 2, title: 'Right' }),
    ]);
    const rows = html.split('<tr').slice(1);
    const index = rows.findIndex((r) => r.includes(`id="f-${AI_FILE}-L2"`));
    const [left, right] = rows[index + 1]!.split('<td').slice(1);
    expect(left).toContain('Left');
    expect(left).not.toContain('Right');
    expect(right).toContain('Right');
  });

  it('shows the toggle only when there are findings', async () => {
    const latest = { enabled: true, job: aiJob(), findings: [aiFinding()] };
    expect(render(<AiFindingsToggle />, latest)).toContain('Show AI findings (1)');
    expect(render(<AiFindingsToggle />, { ...latest, findings: [] })).toBe('');
  });
});
