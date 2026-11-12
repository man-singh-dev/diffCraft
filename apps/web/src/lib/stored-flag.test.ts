import { describe, expect, it, vi } from 'vitest';
import { createFlagStore } from './stored-flag';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('createFlagStore', () => {
  it('starts from the fallback and remembers a change across stores', () => {
    const storage = memoryStorage();
    const store = createFlagStore('k', true, () => storage);
    expect(store.get()).toBe(true);
    store.set(false);
    expect(store.get()).toBe(false);
    expect(createFlagStore('k', true, () => storage).get()).toBe(false);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const store = createFlagStore('k', true, () => memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(false);
    unsubscribe();
    store.set(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('falls back to memory when storage throws', () => {
    const store = createFlagStore('k', true, () => throwing);
    expect(store.get()).toBe(true);
    store.set(false);
    expect(store.get()).toBe(false);
  });

  it('uses the fallback without storage or with a value it does not know', () => {
    expect(createFlagStore('k', true, () => undefined).get()).toBe(true);
    const storage = memoryStorage();
    storage.setItem('k', 'maybe');
    expect(createFlagStore('k', false, () => storage).get()).toBe(false);
  });
});
