/**
 * Active-reaction tracking: the script's belief about which reactions are
 * currently open, reconciled against authoritative sources.
 *
 * Authority rules:
 *   1. The reacties page is the ONLY source that can confirm a reaction is
 *      open. Any visit overwrites our belief with what SSH reports.
 *   2. A listing whose deadline has passed cannot hold a slot, even if SSH
 *      still lists it (stale cache) — we drop it locally.
 *   3. Our own applier may add optimistically after a confirmed apply; the
 *      next reacties visit corrects any mistake.
 *
 * The planner counts THIS set, never db.listings[].status (which is history,
 * not presence).
 */

import { load, mutate } from "./storage";
import { getListing, upsertListing } from "./listings";
import { log } from "../core/logger";

/**
 * A reaction is gone (withdrawn/closed/expired): the room is no longer
 * applied, so reset it to a re-applicable state ("new"). The planner excludes
 * only genuinely-active/refused/failed rooms, so a freed slot can be filled
 * again with a room we just unapplied.
 */
function resetListingToEligible(id: string): void {
  upsertListing(id, { status: "new", statusTs: Date.now() }, "run");
}

/** Register a reaction as active (optimistic, e.g. right after our apply). */
export function markReactionActive(id: string): void {
  mutate((state) => {
    const existing = state.activeReactions[id];
    state.activeReactions[id] = {
      sinceTs: existing?.sinceTs ?? Date.now(),
      lastConfirmedTs: existing?.lastConfirmedTs ?? 0, // not yet SSH-confirmed
    };
  });
  log.debug(`slot+: ${id} marked active (optimistic)`);
}

/** Remove a reaction from the active set (withdrawn, closed, or expired). */
export function markReactionInactive(id: string, cause: string): void {
  let wasActive = false;
  mutate((state) => {
    if (!state.activeReactions[id]) return;
    delete state.activeReactions[id];
    wasActive = true;
  });
  if (wasActive) resetListingToEligible(id);
  log.info(`slot-: ${id} removed (${cause})`);
}

/**
 * Deadline check: a reaction whose window has provably passed cannot be an
 * active slot. Uses the absolute endsAtTs — exact from the room page, or the
 * overview countdown estimate rounded UP, so we never expire a live listing
 * early. No freshness heuristic needed: an absolute deadline is timeless.
 */
function isExpired(id: string): boolean {
  const listing = getListing(id);
  if (!listing || listing.endsAtTs === undefined) return false;
  return listing.endsAtTs <= Date.now();
}

/**
 * Eager expiry sweep: drop active reactions whose window passed, on ANY page
 * load, so a freed slot is usable without waiting for a reacties visit.
 * The reacties page remains the only authority for *openness*; an expired
 * deadline is a hard clock fact that outranks even SSH's stale cache.
 */
export function pruneExpiredReactions(): number {
  const expired: string[] = [];
  mutate((state) => {
    for (const id of Object.keys(state.activeReactions)) {
      if (isExpired(id)) expired.push(id);
    }
    for (const id of expired) delete state.activeReactions[id];
  });
  for (const id of expired) {
    resetListingToEligible(id);
    log.info(`slot-: ${id} deadline passed (pruned)`);
  }
  return expired.length;
}

/**
 * Reconcile against the reacties page (the authority). Called on every
 * reacties visit.
 *   - ids SSH reports open -> kept/added with lastConfirmedTs = now
 *   - ids we believe active but SSH does not list -> removed (desync fix)
 */
export function reconcileWithReacties(
  openIds: string[],
  sshOpenCount: number | undefined,
  sshLimit: number | undefined,
): void {
  const now = Date.now();
  const reported = new Set(openIds);
  let added = 0;
  let removed = 0;
  let expired = 0;
  const droppedIds: string[] = [];

  mutate((state) => {
    // Add/update everything SSH reports as open.
    for (const id of openIds) {
      const existing = state.activeReactions[id];
      state.activeReactions[id] = {
        sinceTs: existing?.sinceTs ?? now,
        lastConfirmedTs: now,
      };
      if (!existing) added += 1;
    }
    // Drop anything SSH no longer reports.
    for (const id of Object.keys(state.activeReactions)) {
      if (!reported.has(id)) {
        delete state.activeReactions[id];
        removed += 1;
        droppedIds.push(id);
        log.info(`slot-: ${id} not on reacties page anymore (authority)`);
      }
    }
    // Drop expired windows even if SSH still lists them.
    for (const id of Object.keys(state.activeReactions)) {
      if (isExpired(id)) {
        delete state.activeReactions[id];
        expired += 1;
        droppedIds.push(id);
        log.info(`slot-: ${id} deadline passed (expired)`);
      }
    }
  });

  // Rooms we no longer hold a reaction for become re-applicable, so freed
  // slots can be refilled (e.g. after a manual withdraw on the site).
  for (const id of droppedIds) resetListingToEligible(id);

  const remaining = Object.keys(load().activeReactions);
  log.info(
    `reconcile: ${openIds.length} open on SSH (+${added} new, -${removed} gone, -${expired} expired)` +
      (sshOpenCount !== undefined ? `, SSH counter says ${sshOpenCount}/${sshLimit ?? "?"}` : "") +
      ` -> we track ${remaining.length}`,
    remaining,
  );
}

/** Current active count (what the planner uses). */
export function activeCount(): number {
  return Object.keys(load().activeReactions).length;
}
