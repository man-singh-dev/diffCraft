export interface FlagStore {
  get: () => boolean;
  set: (value: boolean) => void;
  subscribe: (listener: () => void) => () => void;
}

// Storage can be missing (server) or throw (private mode, blocked cookies): the flag then lives in memory only.
export function createFlagStore(
  key: string,
  fallback: boolean,
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined,
): FlagStore {
  let value: boolean | undefined;
  const listeners = new Set<() => void>();

  const read = (): boolean => {
    try {
      const stored = storage()?.getItem(key);
      return stored === 'true' ? true : stored === 'false' ? false : fallback;
    } catch {
      return fallback;
    }
  };

  return {
    get() {
      value ??= read();
      return value;
    },
    set(next) {
      value = next;
      try {
        storage()?.setItem(key, String(next));
      } catch {
        // Kept in memory for this page.
      }
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const browserStorage = (): Storage | undefined =>
  typeof window === 'undefined' ? undefined : window.localStorage;
