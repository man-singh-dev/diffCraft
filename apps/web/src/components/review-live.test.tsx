import type { PresenceEvent } from '@diffcraft/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReviewRoomStatus } from '@/lib/realtime/review-room';
import { ReviewLiveContext, ViewingNow } from './review-live';

const ME = '01a17e5e-aa56-7985-be46-bf5f1c7e7f01';
const ASHA = '01a17e5e-aa56-7985-be46-bf5f1c7e7f02';
const presence: PresenceEvent = {
  reviewId: '01a17e5e-aa56-7985-be46-bf5f1c7e7f10',
  viewers: [
    { id: ASHA, displayName: 'Asha' },
    { id: ME, displayName: 'Me' },
  ],
  total: 2,
  at: '2026-11-12T10:00:00.000Z',
};

function render(status: ReviewRoomStatus, current: PresenceEvent | null = presence) {
  return renderToStaticMarkup(
    <ReviewLiveContext.Provider
      value={{ status, deleted: false, workspaceId: 'w', presence: current, viewerId: ME }}
    >
      <ViewingNow />
    </ReviewLiveContext.Provider>,
  );
}

describe('ViewingNow', () => {
  it('shows who is viewing while live, with a full sentence for screen readers', () => {
    const html = render('live');
    expect(html).toContain('<span aria-hidden="true">You, Asha viewing</span>');
    expect(html).toContain('<span class="sr-only">Viewing this review: you and Asha.</span>');
  });

  it.each<ReviewRoomStatus>(['connecting', 'reconnecting', 'offline', 'disabled'])(
    'is hidden while %s',
    (status) => {
      expect(render(status)).toBe('');
    },
  );

  it('is hidden until the first presence arrives', () => {
    expect(render('live', null)).toBe('');
  });

  it('is hidden outside a review', () => {
    expect(renderToStaticMarkup(<ViewingNow />)).toBe('');
  });
});
