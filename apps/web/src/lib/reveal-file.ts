const REVEAL_FILE_EVENT = 'diffcraft:reveal-file';

export function revealFile(fileId: string): void {
  window.dispatchEvent(new CustomEvent<string>(REVEAL_FILE_EVENT, { detail: fileId }));
}

export function onRevealFile(fileId: string, onReveal: () => void): () => void {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === fileId) onReveal();
  };
  window.addEventListener(REVEAL_FILE_EVENT, listener);
  return () => window.removeEventListener(REVEAL_FILE_EVENT, listener);
}
