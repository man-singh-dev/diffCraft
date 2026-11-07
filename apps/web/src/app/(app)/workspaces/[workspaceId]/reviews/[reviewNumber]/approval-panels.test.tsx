import type {
  Review,
  ReviewDecision,
  ReviewEvent,
  ReviewState,
  WorkspaceRole,
} from '@diffcraft/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/approval-actions', () => ({
  assignReviewers: vi.fn(),
  removeReviewer: vi.fn(),
  submitDecision: vi.fn(),
  mergeReview: vi.fn(),
  updateRules: vi.fn(),
}));

const { MergeBox } = await import('./merge-box.js');
const { DecisionBox } = await import('./decision-box.js');
const { ReviewHistory } = await import('./review-history.js');
const { ApprovalRulesCard } = await import('../../approval-rules-card.js');

const WS = '3f2b8c1e-5d4a-4e6b-9c7d-1a2b3c4d5e6f';
const AUTHOR = '01a17e5e-aa56-7985-be46-bf5f1c7e7f01';
const ME = '01a17e5e-aa56-7985-be46-bf5f1c7e7f02';

const REVIEW: Review = {
  id: '01a17e5e-aa56-7985-be46-bf5f1c7e7f10',
  workspaceId: WS,
  number: 7,
  title: 'Change',
  description: null,
  status: 'open',
  author: { id: AUTHOR, displayName: 'Asha' },
  filesChanged: 1,
  additions: 1,
  deletions: 1,
  createdAt: '2026-11-05T10:00:00.000Z',
};

const BLOCKED: ReviewState = {
  state: 'changes_requested',
  approvals: 0,
  requiredApprovals: 1,
  openThreads: 2,
  canMerge: false,
  reasons: ['Ravi requested changes', '0 of 1 required approval'],
};
const READY: ReviewState = {
  state: 'approved',
  approvals: 1,
  requiredApprovals: 1,
  openThreads: 0,
  canMerge: true,
  reasons: [],
};

const viewer = (userId: string, role: WorkspaceRole) => ({ userId, role });

const mergeButton = (html: string) => html.match(/<button[^>]*>Merge<\/button>/)?.[0] ?? null;

describe('MergeBox', () => {
  it('lists the reasons under "Can\'t merge yet" and disables Merge for the author', () => {
    const html = renderToStaticMarkup(
      <MergeBox
        workspaceId={WS}
        review={REVIEW}
        state={BLOCKED}
        viewer={viewer(AUTHOR, 'member')}
      />,
    );
    expect(html).toContain('Can&#x27;t merge yet');
    expect(html).toContain('<li>Ravi requested changes</li>');
    expect(html).toContain('<li>0 of 1 required approval</li>');
    const button = mergeButton(html);
    expect(button).toContain('disabled=""');
    expect(button).toContain('aria-describedby="merge-reasons"');
  });

  it('enables Merge for the author and for admins when the rules pass', () => {
    for (const v of [viewer(AUTHOR, 'member'), viewer(ME, 'admin'), viewer(ME, 'owner')]) {
      const html = renderToStaticMarkup(
        <MergeBox workspaceId={WS} review={REVIEW} state={READY} viewer={v} />,
      );
      expect(html).toContain('Ready to merge');
      expect(html).not.toContain('<ul');
      expect(mergeButton(html)).not.toContain('disabled=""');
    }
  });

  it('hides Merge from members who are not the author and from viewers', () => {
    for (const v of [viewer(ME, 'member'), viewer(ME, 'viewer'), viewer(AUTHOR, 'viewer')]) {
      for (const state of [READY, BLOCKED]) {
        const html = renderToStaticMarkup(
          <MergeBox workspaceId={WS} review={REVIEW} state={state} viewer={v} />,
        );
        expect(mergeButton(html)).toBeNull();
      }
    }
  });
});

describe('DecisionBox', () => {
  const render = (props: {
    userId: string;
    role: WorkspaceRole;
    assigned: boolean;
    review?: Review;
  }) =>
    renderToStaticMarkup(
      <DecisionBox
        workspaceId={WS}
        review={props.review ?? REVIEW}
        viewer={viewer(props.userId, props.role)}
        isAssigned={props.assigned}
      />,
    );

  it('shows Approve and Request changes to an assigned member who is not the author', () => {
    for (const role of ['member', 'admin', 'owner'] as const) {
      const html = render({ userId: ME, role, assigned: true });
      expect(html).toContain('Your review');
      expect(html).toContain('>Approve</button>');
      expect(html).toContain('>Request changes</button>');
      expect(html).toContain('maxLength="10000"');
    }
  });

  it('shows nothing to unassigned members, to viewers, or on a closed review', () => {
    expect(render({ userId: ME, role: 'member', assigned: false })).toBe('');
    expect(render({ userId: ME, role: 'viewer', assigned: true })).toBe('');
    expect(
      render({
        userId: ME,
        role: 'member',
        assigned: true,
        review: { ...REVIEW, status: 'closed' },
      }),
    ).toBe('');
  });

  it('tells the author they cannot review their own change, even if assigned', () => {
    for (const assigned of [false, true]) {
      const html = render({ userId: AUTHOR, role: 'owner', assigned });
      expect(html).toContain('You can&#x27;t review your own change.');
      expect(html).not.toContain('<button');
    }
  });
});

describe('ApprovalRulesCard', () => {
  const rules = { requiredApprovals: 2, requireResolvedThreads: true };

  it('is read-only text for members and viewers', () => {
    for (const role of ['viewer', 'member'] as const) {
      const html = renderToStaticMarkup(
        <ApprovalRulesCard workspaceId={WS} rules={rules} role={role} />,
      );
      expect(html).toContain('2 approvals required before merging.');
      expect(html).toContain('All threads must be resolved before merging.');
      expect(html).not.toContain('<form');
      expect(html).not.toContain('<input');
    }
  });

  it('is a form with the saved values for admins and owners', () => {
    for (const role of ['admin', 'owner'] as const) {
      const html = renderToStaticMarkup(
        <ApprovalRulesCard
          workspaceId={WS}
          rules={{ requiredApprovals: 0, requireResolvedThreads: false }}
          role={role}
        />,
      );
      expect(html).toContain('<form');
      expect(html).toMatch(/<input[^>]*id="required-approvals"[^>]*value="0"/);
      const checkbox = html.match(/<input[^>]*name="require-resolved-threads"[^>]*>/)?.[0];
      expect(checkbox).toContain('type="checkbox"');
      expect(checkbox).not.toContain('checked');
      expect(html).toContain('>Save</button>');
    }
  });
});

describe('ReviewHistory', () => {
  const ravi = { id: ME, displayName: 'Ravi' };
  const events: ReviewEvent[] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      reviewId: REVIEW.id,
      actor: { id: AUTHOR, displayName: 'Asha' },
      type: 'reviewer_assigned',
      data: { userId: ME },
      createdAt: '2026-11-05T10:00:00.000Z',
    },
  ];
  const decisions: ReviewDecision[] = [
    {
      id: '00000000-0000-4000-8000-000000000002',
      reviewId: REVIEW.id,
      reviewer: ravi,
      decision: 'request_changes',
      body: '<script>alert(1)</script>\n<img src=x onerror=alert(1)>',
      createdAt: '2026-11-05T11:30:00.000Z',
    },
  ];

  it('renders the entries in order, with the decision body as text', () => {
    const html = renderToStaticMarkup(
      <ReviewHistory events={events} decisions={decisions} names={new Map([[ME, 'Ravi']])} />,
    );
    expect(html.indexOf('Asha assigned Ravi')).toBeLessThan(html.indexOf('Ravi requested changes'));
    expect(html).toContain('Nov 5, 2026, 11:30 AM UTC');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('says when nothing has happened', () => {
    expect(
      renderToStaticMarkup(<ReviewHistory events={[]} decisions={[]} names={new Map()} />),
    ).toContain('Nothing has happened yet.');
  });
});
