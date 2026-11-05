'use client';

import { useEffect } from 'react';
import { parseHashTarget } from '@/lib/diff-params';
import { revealFile } from '@/lib/reveal-file';

// Long enough for a large lazy diff to load and stream in.
const WAIT_FOR_TARGET_MS = 20_000;

export function HashTarget() {
  useEffect(() => {
    let stop: (() => void) | null = null;

    function handleHash() {
      stop?.();
      stop = null;
      const target = parseHashTarget(window.location.hash);
      if (!target) return;

      revealFile(target.fileId);
      const go = () => {
        // Re-navigating to the fragment scrolls to it and makes it :target, which the browser skipped if it didn't exist yet. No hashchange fires.
        window.location.replace(`#${target.elementId}`);
      };
      const existing = document.getElementById(target.elementId);
      if (existing) {
        // Already scrolled to by the browser, unless it was in a collapsed file that revealFile is now expanding.
        if (existing.closest('[hidden]')) requestAnimationFrame(go);
        return;
      }

      const observer = new MutationObserver(() => {
        if (!document.getElementById(target.elementId)) return;
        stop?.();
        go();
      });
      const timeout = window.setTimeout(() => stop?.(), WAIT_FOR_TARGET_MS);
      observer.observe(document.body, { childList: true, subtree: true });
      stop = () => {
        observer.disconnect();
        window.clearTimeout(timeout);
      };
    }

    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => {
      window.removeEventListener('hashchange', handleHash);
      stop?.();
    };
  }, []);

  return null;
}
