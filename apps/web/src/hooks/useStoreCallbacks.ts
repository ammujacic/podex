import { useRef } from 'react';

/**
 * Hook to maintain stable references to store callbacks.
 *
 * This pattern is used in socket hooks to avoid re-running effects when store
 * selectors change. The ref is updated on every render, but the reference itself
 * remains stable, preventing unnecessary effect re-runs.
 *
 * @example
 * ```tsx
 * const callbacks = useStoreCallbacks({
 *   addMessage: useSessionStore((s) => s.addMessage),
 *   updateStatus: useSessionStore((s) => s.updateStatus),
 * });
 *
 * useEffect(() => {
 *   socket.on('message', (data) => {
 *     callbacks.current.addMessage(data);
 *   });
 * }, [sessionId]); // callbacks not in deps - stays stable
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useStoreCallbacks<T extends Record<string, (...args: any[]) => any>>(
  callbacks: T
): React.MutableRefObject<T> {
  const ref = useRef(callbacks);
  ref.current = callbacks;
  return ref;
}
