/**
 * SSH XL Daily Auto-Apply — entry point.
 *
 * sshxl.nl is a React SPA: internal navigation never reloads the page, so the
 * route watcher re-runs the router on every path change. The global hub
 * (pill + drawer, see ui/Hub.tsx) is mounted ONCE at startup and remembers its
 * open/closed + tab state (ui/hubState.ts); routes only sync page data:
 *
 * Overview (/nl/aanbod):   sync listing DB + autofill + mark cards
 * Room     (/nl/aanbod/…): refine the record, apply when the run owns it
 * Profile  (mijn-profiel): scrape profile into preferences
 * Reacties (reacties[…]):  sync slots/reconcile authority
 */

import { processReactiesPage, processRoom } from "./core/applier";
import { processUnreactPage } from "./core/unreact";
import { watchRoutes, isStale, currentRoute } from "./core/router";
import { log } from "./core/logger";
import { mountHub, refreshStore, initOverviewMarks, markOverviewCards } from "./ui";
import {
  parseHours,
  scrapeRoomPageWhenReady,
  scrapeReactionSlotsWhenReady,
  scrapeWhenReady,
} from "./data/scrapers";
import type { PageKind } from "./data/page";
import { buttonLabel, headerActionButton, isAppliedLabel, listingId } from "./data/page";
import { syncProfileFromPage } from "./data/preferences";
import { syncCardsIntoDb, syncReactionSlots, buildSlotPlan } from "./data/planner";
import { upsertListing, readDb } from "./data/listings";
import type { ListingRecord } from "./data/listings";
import { load, wipeAll } from "./data/storage";
import { pruneExpiredReactions, activeCount } from "./data/reactions";
import { autofillFilters } from "./data/filters";

declare global {
  interface Window {
    __sshxlAA?: unknown;
  }
}

// Console/test hook: inspect state, re-run planners, trigger autofill.
window.__sshxlAA = {
  state: () => ({ ...load() }),
  plan: () => {
    syncCardsIntoDb();
    return buildSlotPlan(load().quota, activeCount());
  },
  parseRemainingHours: parseHours,
  slots: () => load().activeReactions,
  reset: () => wipeAll(),
};

/** Sync overview cards + autofill the site's own filter selects. */
function syncOverview(): void {
  const merged = syncCardsIntoDb();
  log.info(
    `overview sync: ${merged.length} cards merged, ${Object.keys(readDb().listings).length} total tracked`,
  );
  const filled = autofillFilters();
  if (filled.city || filled.allocation) {
    log.info("filters autofilled", filled);
  }
  refreshStore();
}

async function route(kind: PageKind): Promise<void> {
  const ctx = currentRoute();
  log.debug("route", kind, location.pathname);

  // Expired reaction windows free slots no matter which page we are on.
  if (pruneExpiredReactions() > 0) refreshStore();

  // Profile page: scrape (after hydration).
  if (/\/nl\/mijn-ssh\/mijn-profiel/.test(location.pathname)) {
    const scraped = await syncProfileFromPage();
    if (isStale(ctx.epoch)) {
      log.debug("profile sync discarded: route changed while scraping");
      return;
    }
    // The scrape mutated storage; bump the mirror signal so subscribers
    // re-render with the fresh profile.
    refreshStore();
    log.info("profile synced", scraped ? load().preferences : "(nothing found)");
    return;
  }

  switch (kind) {
    case "overview": {
      // The site renders the card list AFTER our route fires (hydration), so
      // syncing immediately sees an empty DOM and learns nothing (no listings,
      // no street/city options). Wait until cards exist, then sync + mark.
      void scrapeWhenReady(
        () => (document.querySelectorAll(".card--property").length > 0 ? true : undefined),
        "overview cards",
        15_000,
      ).then((found) => {
        if (!found || isStale(ctx.epoch)) return;
        syncOverview();
        markOverviewCards();
        log.info("overview cards synced after render");
      });
      break;
    }
    case "room": {
      // Every room visit refines the record: exact deadline, position,
      // requirements — overrides the overview's countdown estimate. Runs in
      // parallel with the apply flow; it must never delay it.
      const id = listingId();
      if (id) {
        void scrapeRoomPageWhenReady().then((detail) => {
          if (isStale(ctx.epoch)) {
            log.debug("room detail merge discarded: route changed while scraping");
            return;
          }
          if (Object.keys(detail).length === 0) {
            log.debug(`room ${id}: no detail fields found on page`);
            return;
          }
          // The header button is the applied oracle: "Bekijk mijn reactie"
          // means we hold a reaction here (same signal the applier uses).
          const button = headerActionButton();
          const patch: Partial<ListingRecord> = {
            ...detail,
            detailTs: Date.now(),
            lastSeenTs: Date.now(),
          };
          if (button && isAppliedLabel(buttonLabel(button))) patch.status = "applied";
          upsertListing(id, patch, "room");
          refreshStore();
          log.info("room details merged", id, detail);
        });
      }
      await processRoom();
      break;
    }
    case "reacties":
      if (/\/nl\/mijn-ssh\/reacties\/\d+$/.test(location.pathname)) {
        await processUnreactPage();
      } else {
        // Hydration-aware scrape + slot reconciliation (the authority).
        void scrapeReactionSlotsWhenReady().then((result) => {
          if (isStale(ctx.epoch)) {
            log.debug("reacties sync discarded: route changed while scraping");
            return;
          }
          syncReactionSlots(result.slots, { openCount: result.openCount, limit: result.limit });
          refreshStore();
          log.info(
            `reacties: ${result.openCount}/${result.limit} open slots, ${result.slots.length} teasers`,
          );
        });
        await processReactiesPage();
      }
      break;
    case "other":
      break;
  }
}

// One mount for the whole session: the hub survives SPA navigations.
mountHub();
initOverviewMarks();
watchRoutes((kind) => route(kind));
const state = load();
log.info("ready on", location.pathname);
log.debug(
  `startup: quota=${state.quota}, listings=${Object.keys(state.db.listings).length}, activeReactions=${Object.keys(state.activeReactions).length}${state.run ? `, run active idx=${state.run.idx}/${state.run.queue.length}` : ""}`,
);
