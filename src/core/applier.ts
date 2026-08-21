/**
 * The applier: drives one room page through the confirm flow, then advances
 * the active run. All navigation is full page loads (location.assign), so the
 * run state must live in storage — every module reads it fresh via load().
 */

import { sleep, waitFor } from "./dom";
import {
  buttonLabel,
  headerActionButton,
  isAppliedLabel,
  isReactLabel,
  listingId,
} from "../data/page";
import { upsertListing } from "../data/listings";
import { markReactionActive, activeCount } from "../data/reactions";
import { buildSlotPlan } from "../data/planner";
import { load, mutate } from "../data/storage";
import type { ListingStatus as ApplicationStatus } from "../data/listings";
import { isStale, currentRoute } from "./router";
import { resetProgress, setProgress } from "./progress";
import { log } from "./logger";

export const MAX_RUN_MS = 15 * 60 * 1000;
export const NEXT_ROOM_DELAY_MS = 1500;
const REACTIES_GRACE_MS = 90_000;

export const T = {
  headerButton: 30_000,
  confirmModal: 20_000,
  appliedLabel: 20_000,
  cards: 30_000,
};

/**
 * Modals (e.g. #a11y-modal) sit pre-rendered in the DOM with aria-hidden="true",
 * so a bare selector would match while invisible. Only react to visible ones.
 */
function visibleModal(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(".modal")).find(
      (modal) => modal.getClientRects().length > 0,
    ) ?? null
  );
}

function modalConfirmButton(modal: HTMLElement): HTMLButtonElement | null {
  const button = modal.querySelector<HTMLButtonElement>(".modal__footer .button--primary");
  return button && /bevestigen/i.test(button.textContent ?? "") ? button : null;
}

/** Human-readable refusal reason, e.g. "Niet mogelijk om te reageren". */
function modalTitle(modal: HTMLElement): string | null {
  const title = modal.querySelector(".modal__title")?.textContent?.trim() ?? "";
  return title || null;
}

/** Record the current room's outcome and navigate to the next pick, or finish. */
async function advance(
  result: ApplicationStatus | null,
  details: { reason?: string } = {},
  epoch?: number,
): Promise<void> {
  const state = load();
  const run = state.run;
  // Only ever advance an APPLY run — the unreact runner has its own flow, and
  // letting the refill logic touch an unreact run would re-apply withdrawn
  // (reset-to-eligible) listings.
  if (!run || run.kind !== "apply") return;
  const item = run.queue[run.idx];
  if (item && result) {
    upsertListing(item.id, {
      status: result,
      statusTs: Date.now(),
      ...(details.reason !== undefined ? { reason: details.reason } : {}),
    });
  }

  const quota = load().quota;
  const slotsFree = activeCount() < quota;
  const notTimedOut = Date.now() - run.startedTs <= MAX_RUN_MS;

  run.idx += 1;
  let next = run.idx < run.queue.length ? run.queue[run.idx] : undefined;

  // The queue is exhausted but slots remain free and we are under budget:
  // refill with a fresh plan so the run continues instead of stopping for a
  // manual re-run. Anything already processed in this run is never re-picked,
  // and the planner already excludes applied/refused/failed/expired rooms.
  if (!next && slotsFree && notTimedOut) {
    const processed = new Set(run.queue.map((queueItem) => queueItem.id));
    const refill = buildSlotPlan(quota, activeCount())
      .picks.filter((pick) => !processed.has(pick.id))
      .map((pick) => ({ id: pick.id, url: pick.url, title: pick.title }));
    if (refill.length > 0) {
      log.info(`run refilled: ${refill.length} more room(s) queued`);
      run.queue = refill;
      run.idx = 0;
      next = run.queue[0];
    }
  }

  const done = !next;
  mutate((s) => {
    s.run = done ? null : run;
  });
  if (!done) {
    if (next) {
      setProgress({
        index: run.idx + 1,
        roomTitle: next.title,
        step: "Opening next room…",
      });
      await sleep(NEXT_ROOM_DELAY_MS);
      if (epoch !== undefined && isStale(epoch)) {
        log.warn("run flow interrupted by navigation; run left paused");
        return;
      }
      location.assign(next.url);
    }
  } else {
    resetProgress();
    // Land on the reacties page so the finished run's reactions are
    // confirmed by the authority and visible to the user.
    if (!/\/nl\/mijn-ssh\/reacties/.test(location.pathname)) {
      await sleep(NEXT_ROOM_DELAY_MS);
      if (epoch !== undefined && isStale(epoch)) {
        log.warn("run finished; navigation to reacties aborted (route changed)");
        return;
      }
      log.info("run finished; navigating to reacties");
      location.assign("/nl/mijn-ssh/reacties");
    }
  }
}

/** Entry point on a room page. Hands off unless this room owns the active run. */
export async function processRoom(): Promise<void> {
  const state = load();
  const id = listingId();
  if (!state.run || state.run.kind !== "apply" || !id || state.run.queue[state.run.idx]?.id !== id)
    return;

  const item = state.run.queue[state.run.idx];
  if (!item) return;
  const epoch = currentRoute().epoch;
  log.info(`applying ${state.run.idx + 1}/${state.run.queue.length}:`, item.title);
  setProgress({
    active: true,
    index: state.run.idx + 1,
    total: state.run.queue.length,
    roomTitle: item.title,
    step: "Waiting for page…",
  });

  let button: HTMLButtonElement;
  try {
    button = await waitFor(headerActionButton, T.headerButton, "header action button");
  } catch {
    if (isStale(epoch)) {
      log.warn("room flow aborted: navigated away before header appeared; run paused");
      return;
    }
    log.warn("header button never appeared; marking failed", location.pathname);
    setProgress({ step: "Page did not load — skipping." });
    await advance("failed", { reason: "page did not load" }, epoch);
    return;
  }
  if (isStale(epoch)) {
    log.warn("room flow aborted: route changed while waiting for header; run paused");
    return;
  }

  const label = buttonLabel(button);
  if (isAppliedLabel(label)) {
    log.debug("already applied, skipping");
    setProgress({ step: "Already applied — moving on." });
    await advance("applied", {}, epoch); // already applied on an earlier pass
    return;
  }
  if (!isReactLabel(label)) {
    setProgress({ step: "No reaction button — skipping." });
    await advance("failed", { reason: "no reaction button" }, epoch);
    return;
  }

  log.debug("clicking Reageer");
  setProgress({ step: "Clicking Reageer…" });
  button.click();

  try {
    const modal = await waitFor(visibleModal, T.confirmModal, "confirm modal");
    if (isStale(epoch)) {
      log.warn("room flow aborted: route changed before confirm dialog resolved; run paused");
      return;
    }
    const confirm = modalConfirmButton(modal);
    if (confirm) {
      setProgress({ step: "Confirming…" });
      confirm.click();
    } else {
      // The site refused (e.g. "Niet mogelijk om te reageren"). Dismiss the
      // dialog and record it permanently so future plans skip this room.
      const reason = modalTitle(modal);
      log.warn("site refused reaction:", reason ?? "(no title)");
      setProgress({ step: `Refused: ${reason ?? "not eligible"}` });
      modal.querySelector<HTMLButtonElement>(".modal__footer button")?.click();
      await advance("not-eligible", { reason: reason ?? undefined }, epoch);
      return;
    }
  } catch {
    if (isStale(epoch)) {
      log.warn("room flow aborted: route changed during confirm dialog; run paused");
      return;
    }
    setProgress({ step: "No confirmation dialog — skipping." });
    await advance("failed", { reason: "no confirmation dialog" }, epoch);
    return;
  }

  setProgress({ step: "Verifying reaction…" });
  try {
    await waitFor(
      () => {
        const after = headerActionButton();
        return after && isAppliedLabel(buttonLabel(after)) ? after : null;
      },
      T.appliedLabel,
      "applied confirmation",
    );
    if (isStale(epoch)) {
      log.warn("room flow aborted: route changed before applied state confirmed; run paused");
      return;
    }
    log.info("reaction confirmed:", item.title);
    markReactionActive(item.id);
    await advance("applied", {}, epoch);
  } catch {
    if (isStale(epoch)) {
      log.warn("room flow aborted: route changed during applied verification; run paused");
      return;
    }
    // Submitted but unconfirmed: excluded from future plans, costs no quota.
    // A later revisit sees the applied header and settles the record.
    log.warn("could not confirm applied state; recording unknown");
    await advance("unknown", {}, epoch);
  }
}

/**
 * The site can land on the reacties page right after a successful confirm.
 * Only follow through immediately after one of our own navigations, so a user
 * browsing their reacties page normally never triggers us. The reacties sync
 * already recorded the room as applied (authority); advancing without a status
 * write keeps that truth intact.
 */
export async function processReactiesPage(): Promise<void> {
  const run = load().run;
  if (!run || Date.now() - run.lastNavTs > REACTIES_GRACE_MS) return;
  const epoch = currentRoute().epoch;
  await advance(null, {}, epoch);
}
