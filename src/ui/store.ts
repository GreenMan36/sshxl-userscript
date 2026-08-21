/**
 * Storage mirror signal: the single reactive view of persisted state.
 * Bump via refreshStore() after any mutate() so subscribers re-render.
 */

import { signal } from "@preact/signals";
import { load } from "../data/storage";
import type { StoreState } from "../data/storage";

export const storeSignal = signal<StoreState>(load());

export function refreshStore(): void {
  // load() returns the SAME cached object that mutate() edits in place, so a
  // plain assignment would keep the identical reference and Preact signals
  // (reference-compared) would never notify. Spread to a new top-level object
  // so subscribers re-render.
  storeSignal.value = { ...load() };
}
