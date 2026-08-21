/**
 * Run-progress as a Preact signal: the applier writes, the HUD/panel read.
 * Signals update subscribers without hook machinery and work outside
 * components (the applier is plain TS).
 */

import { signal } from "@preact/signals";

export interface ProgressState {
  /** false = no active run. */
  active: boolean;
  roomTitle: string;
  step: string;
  /** 1-based index into the queue; total = queue length. */
  index: number;
  total: number;
}

const INITIAL: ProgressState = {
  active: false,
  roomTitle: "",
  step: "",
  index: 0,
  total: 0,
};

export const progress = signal<ProgressState>({ ...INITIAL });

export function setProgress(patch: Partial<ProgressState>): void {
  progress.value = { ...progress.value, ...patch };
}

export function resetProgress(): void {
  progress.value = { ...INITIAL };
}
