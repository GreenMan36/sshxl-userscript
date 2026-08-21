/**
 * Mass unreact: walk open reaction detail pages (/nl/mijn-ssh/reacties/<id>)
 * and withdraw reactions.
 *
 * The list page has no withdraw button; the action lives on each reaction's
 * detail page, which we do not have a saved fixture for. So the runner is
 * built label-driven with configurable patterns and a confirmation step,
 * mirroring the room apply flow (click action -> confirm modal). If the
 * button is not found, the item is skipped, never guessed at.
 *
 * Safety: requires an explicit queue built by the user from the panel; there
 * is no "unreact to everything" one-click.
 */

import { sleep, waitFor } from "./dom";
import { resetProgress, setProgress } from "./progress";
import { log } from "./logger";
import { markReactionInactive } from "../data/reactions";
import { load, mutate } from "../data/storage";
import type { QueueItem } from "../data/storage";

// Real labels (from saved fixture): page button "Reactie intrekken",
// confirm modal primary "Intrekken", secondary "Annuleren" (dismiss).
const UNREACT_LABEL = /reactie\s+intrekken|intrekken/i;
const CONFIRM_LABEL = /^intrekken$/i;
const DISMISS_LABEL = /annuleren/i;

function visibleModal(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(".modal")).find(
      (modal) => modal.getClientRects().length > 0,
    ) ?? null
  );
}

function findActionButton(): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
      const label = (button.textContent ?? "").trim();
      return UNREACT_LABEL.test(label) && button.getClientRects().length > 0;
    }) ?? null
  );
}

/**
 * Withdraw the reaction on the currently loaded detail page.
 * Returns true when a withdrawal was attempted and confirmed.
 */
export async function unreactCurrentPage(
  timeoutMs = 15_000,
): Promise<"withdrawn" | "no-button" | "timeout"> {
  let button: HTMLButtonElement;
  try {
    button = await waitFor(findActionButton, 8_000, "unreact button");
  } catch {
    return "no-button";
  }
  setProgress({ step: "Clicking withdraw…" });
  button.click();

  try {
    const modal = await waitFor(visibleModal, timeoutMs, "unreact confirm modal");
    const buttons = Array.from(modal.querySelectorAll<HTMLButtonElement>("button"));
    const confirmButton = buttons.find((candidate) =>
      CONFIRM_LABEL.test((candidate.textContent ?? "").trim()),
    );
    if (!confirmButton) {
      // Unknown dialog: dismiss it so the page stays usable, then report.
      const dismiss = buttons.find((candidate) =>
        DISMISS_LABEL.test((candidate.textContent ?? "").trim()),
      );
      dismiss?.click();
      log.warn("unreact confirm dialog unrecognized; dismissed instead");
      return "timeout";
    }
    log.debug("confirming withdrawal");
    confirmButton.click();
    await sleep(1_000);
    return "withdrawn";
  } catch {
    return "timeout";
  }
}

/** Start a mass-unreact run over the given reaction ids. */
export function startUnreactRun(reactionIds: string[]): void {
  const queue: QueueItem[] = reactionIds.map((id) => ({
    id,
    url: `https://www.sshxl.nl/nl/mijn-ssh/reacties/${id}`,
    title: `Reaction ${id}`,
  }));
  if (queue.length === 0) return;
  mutate((state) => {
    state.run = {
      kind: "unreact",
      startedTs: Date.now(),
      lastNavTs: Date.now(),
      idx: 0,
      queue,
    };
  });
  const first = queue[0];
  if (!first) return;
  setProgress({
    active: true,
    index: 1,
    total: queue.length,
    roomTitle: first.title,
    step: "Opening…",
  });
  location.assign(first.url);
}

/**
 * Process the current reactie detail page as part of an unreact run, then
 * advance. Self-healing: items already withdrawn elsewhere (no longer in
 * activeReactions) are skipped immediately instead of waiting for the button
 * timeout; if we are not on the current item's page (the site redirects after
 * a withdrawal), we navigate to it rather than pausing.
 */
export async function processUnreactPage(): Promise<void> {
  const run = load().run;
  if (!run || run.kind !== "unreact") return;

  // Advance to the next queue item (or finish). Paced only for handoff.
  const advance = async (): Promise<void> => {
    mutate((s) => {
      const r = s.run;
      if (!r || r.kind !== "unreact") return;
      r.idx += 1;
      const next = r.queue[r.idx];
      s.run = next ? r : null;
    });
    const advanced = load().run;
    const next = advanced?.queue[advanced.idx];
    if (next) {
      setProgress({
        active: true,
        index: (advanced?.idx ?? 0) + 1,
        total: advanced?.queue.length ?? 0,
        roomTitle: next.title,
        step: "Opening next…",
      });
      await sleep(1_200);
      location.assign(next.url);
    } else {
      resetProgress();
    }
  };

  const current = run.queue[run.idx];
  if (!current) {
    // Queue exhausted but not cleared (e.g. landed here after a redirect).
    resetProgress();
    mutate((s) => {
      if (s.run?.kind === "unreact") s.run = null;
    });
    return;
  }

  // Already withdrawn/closed elsewhere: skip it rather than waiting 8s for a
  // button that will never appear.
  if (!load().activeReactions[current.id]) {
    log.info(`unreact: ${current.id} no longer active; skipping`);
    await advance();
    return;
  }

  // Not on the current item's page (redirect after a withdrawal): navigate.
  const match = /\/nl\/mijn-ssh\/reacties\/(\d+)$/.exec(location.pathname);
  if (!match || match[1] !== current.id) {
    setProgress({
      active: true,
      index: run.idx + 1,
      total: run.queue.length,
      roomTitle: current.title,
      step: "Opening…",
    });
    location.assign(current.url);
    return;
  }

  setProgress({
    active: true,
    index: run.idx + 1,
    total: run.queue.length,
    roomTitle: current.title,
    step: "Looking for withdraw button…",
  });

  const result = await unreactCurrentPage();
  if (result === "withdrawn") {
    markReactionInactive(current.id, "withdrawn by user/run");
  }
  if (result === "timeout") {
    log.error("unreact stuck (no confirm dialog handled); stopping run");
    resetProgress();
    mutate((s) => {
      if (s.run?.kind === "unreact") s.run = null;
    });
    return;
  }
  if (result === "no-button") {
    log.warn(`no withdraw button found on ${location.pathname}; skipping`);
  }
  await advance();
}
