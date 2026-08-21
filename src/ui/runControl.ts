/** Run lifecycle shared by the panel and the room applier. */

import { mutate } from "../data/storage";
import { setProgress } from "../core/progress";

export function startRun(picks: Array<{ id: string; url: string; title: string }>): void {
  const queue = picks.map(({ id, url, title }) => ({ id, url, title }));
  const first = queue[0];
  if (!first) return;
  mutate((state) => {
    state.run = { kind: "apply", startedTs: Date.now(), lastNavTs: Date.now(), idx: 0, queue };
  });
  setProgress({
    active: true,
    index: 1,
    total: queue.length,
    roomTitle: first.title,
    step: "Opening room…",
  });
  location.assign(first.url);
}

export function stopRun(): void {
  mutate((state) => {
    state.run = null;
  });
}
