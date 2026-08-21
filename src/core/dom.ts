/** Small DOM/promise helpers shared by the UI and the applier. */

export function waitFor<T>(
  get: () => T | null | undefined,
  timeoutMs: number,
  label: string,
  pollMs = 250,
): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const start = Date.now();
  (function poll() {
    let value: T | null | undefined;
    try {
      value = get();
    } catch {
      // transient DOM state while React re-renders: keep polling
    }
    if (value) {
      resolve(value);
      return;
    }
    if (Date.now() - start > timeoutMs) {
      reject(new Error(`timeout: ${label}`));
      return;
    }
    setTimeout(poll, pollMs);
  })();
  return promise;
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
