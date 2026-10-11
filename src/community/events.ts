/* ─── Tiny community event bus ───
   Lets UI pieces react to sign-in/out and availability changes without
   knowing about each other. Keeps the reader decoupled from auth. */

export type CommunityEvent = 'auth' | 'availability';

type Listener = (event: CommunityEvent) => void;

const listeners = new Set<Listener>();

export function onCommunityEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCommunityEvent(event: CommunityEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.warn('Community listener failed.', error);
    }
  }
}
