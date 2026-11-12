import { describe, expect, it, vi } from 'vitest';
import { createRoomEventBus } from './room-event-bus';

const event = {
  reviewId: '01a17e5e-aa56-7985-be46-bf5f1c7e7f10',
  actorId: null,
  at: '2026-11-12T10:00:00.000Z',
  jobId: '01a17e5e-aa56-7985-be46-bf5f1c7e7f30',
  findings: 1,
};

describe('createRoomEventBus', () => {
  it('passes events to every listener that handles them, until it unsubscribes', () => {
    const bus = createRoomEventBus();
    const a = { onAnalysisCompleted: vi.fn(), onResync: vi.fn() };
    const b = { onResync: vi.fn() };
    const unsubscribeA = bus.subscribe(a);
    bus.subscribe(b);

    bus.emit('onAnalysisCompleted', event);
    bus.emit('onResync');
    unsubscribeA();
    bus.emit('onResync');

    expect(a.onAnalysisCompleted.mock.calls).toEqual([[event]]);
    expect(a.onResync).toHaveBeenCalledTimes(1);
    expect(b.onResync).toHaveBeenCalledTimes(2);
  });
});
