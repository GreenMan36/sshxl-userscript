/**
 * Slot-based planner.
 *
 * The site allows a limited number of ACTIVE reactions at once (7 by default,
 * read from the reacties page). When one expires or is closed, a slot frees
 * up and we fill it with the best available listing: urgency-first, filtered
 * by preferences and street lists.
 *
 * RACE NOTE: SSH's own counter is authoritative and can drift from ours
 * (8/7 or 9/7 under concurrent edits). We treat our limit as advisory:
 * `slotLimit` may be tuned independently of SSH's real state, and the
 * reacties page re-sync corrects our view every time it loads. The planner
 * never refuses to act because counts disagree; it just aims at freeSlots.
 */

import type { ListingRecord } from "./listings";
import { parseListingTitle, readDb, upsertListing, pruneStaleListings } from "./listings";
import { collectOverviewCards, cardToRecord } from "./scrapers";
import type { OverviewCard } from "./scrapers";
import { collectCityOptions, collectContractTypes, collectDwellingTypes } from "./filters";
import { load, recordKnownOptions } from "./storage";
import type { StoreState } from "./storage";
import { reconcileWithReacties } from "./reactions";
import { log } from "../core/logger";

export interface Plan {
  /** Active reaction slots: used / limit. */
  activeCount: number;
  slotLimit: number;
  freeSlots: number;
  picks: ListingRecord[];
}

/** One stage of the matching funnel: how many listings remain after it. */
export interface FunnelStep {
  label: string;
  removed: number;
  remaining: number;
}

/**
 * Cumulative matching funnel: applies each ACTIVE filter in planner order and
 * records how many actionable listings remain after it. Unlike isolated
 * per-setting counts, this shows exactly where listings drop and what the
 * final eligible count is.
 */
export function filterFunnel(): { total: number; steps: FunnelStep[]; eligible: number } {
  const state = load();
  const now = Date.now();
  const prefs = state.preferences;
  const base = Object.values(readDb().listings).filter((listing) => {
    if (state.activeReactions[listing.id]) return false;
    if (
      listing.status === "applied" ||
      listing.status === "not-eligible" ||
      listing.status === "failed"
    )
      return false;
    if (listing.endsAtTs !== undefined && listing.endsAtTs <= now) return false;
    return true;
  });

  const steps: FunnelStep[] = [];
  let remaining = base;

  const stage = (
    label: string,
    keep: (listing: ListingRecord) => boolean,
    active: boolean,
  ): void => {
    if (!active) return;
    const kept = remaining.filter(keep);
    steps.push({ label, removed: remaining.length - kept.length, remaining: kept.length });
    remaining = kept;
  };

  stage(
    "Cities",
    (listing) =>
      prefs.cities?.some((city) => city.toLowerCase() === listing.city.toLowerCase()) ?? false,
    (prefs.cities?.length ?? 0) > 0,
  );
  stage(
    "Max rent (after huurtoeslag)",
    (listing) => {
      const rent = effectiveRent(listing);
      return prefs.maxRent === undefined || rent === undefined || rent <= prefs.maxRent;
    },
    prefs.maxRent !== undefined,
  );
  stage(
    "Min surface",
    (listing) =>
      prefs.minSurface === undefined ||
      listing.surface === undefined ||
      listing.surface >= prefs.minSurface,
    prefs.minSurface !== undefined,
  );
  stage(
    "Huurtoeslag",
    (listing) => !prefs.subsidyOnly || listing.subsidyRent !== undefined,
    prefs.subsidyOnly === true,
  );
  stage(
    "Dwelling types",
    (listing) => {
      const dwellingType = listing.dwellingType;
      return (
        !dwellingType ||
        (prefs.dwellingTypes?.some((type) =>
          dwellingType.toLowerCase().includes(type.toLowerCase()),
        ) ??
          false)
      );
    },
    (prefs.dwellingTypes?.length ?? 0) > 0,
  );
  stage(
    "Contract types",
    (listing) => {
      const contractType = listing.contractType;
      return (
        !contractType ||
        (prefs.contractTypes?.some((contract) =>
          contractType.toLowerCase().includes(contract.toLowerCase()),
        ) ??
          false)
      );
    },
    (prefs.contractTypes?.length ?? 0) > 0,
  );
  stage(
    "Allocation",
    (listing) =>
      !listing.allocation ||
      (prefs.allocation?.includes(listing.allocation as "hospiteren" | "bezichtiging") ?? false),
    (prefs.allocation?.length ?? 0) > 0,
  );
  const streetActive =
    state.filters.streetMode === "blacklist"
      ? state.filters.blacklist.length > 0
      : state.filters.whitelist.length > 0;
  stage(
    "Streets",
    (listing) => {
      const haystack = `${listing.street} ${listing.title}`.toLowerCase();
      if (state.filters.streetMode === "blacklist")
        return !state.filters.blacklist.some((needle) => haystack.includes(needle.toLowerCase()));
      return (
        state.filters.whitelist.length === 0 ||
        state.filters.whitelist.some((needle) => haystack.includes(needle.toLowerCase()))
      );
    },
    streetActive,
  );

  return { total: base.length, steps, eligible: remaining.length };
}

/**
 * Merge fresh overview cards into the DB; returns the merged records.
 * Overview data is field-limited (never touches status) and estimates the
 * deadline; the room page refines it later. Also prunes records that have
 * not been seen for 30 days and hold no active reaction.
 */
export function syncCardsIntoDb(): ListingRecord[] {
  const now = Date.now();
  const cards: OverviewCard[] = collectOverviewCards();
  const known = new Set(Object.keys(readDb().listings));
  const streets: string[] = [];
  const cities: string[] = [];
  log.debug(`syncCardsIntoDb: ${cards.length} cards on page`);
  for (const card of cards) {
    const { street, city } = parseListingTitle(card.title);
    streets.push(street);
    cities.push(city);
    const patch = cardToRecord(card, now);
    upsertListing(card.id, patch, "overview");
  }
  // The page tells us what is available: accumulate street/city options, plus
  // the site's own filter dropdowns (the authoritative option lists).
  recordKnownOptions(streets, cities);
  const siteCities = collectCityOptions();
  const siteTypes = collectDwellingTypes();
  const siteContracts = collectContractTypes();
  if (siteCities.length > 0 || siteTypes.length > 0 || siteContracts.length > 0) {
    recordKnownOptions([], siteCities, siteTypes, siteContracts);
  }
  const created = cards.filter((card) => !known.has(card.id)).length;
  const withEstimate = cards.filter((card) => card.endsAtTs !== undefined).length;
  if (created > 0 || withEstimate !== cards.length) {
    log.debug(
      `syncCardsIntoDb: ${created} new, ${withEstimate}/${cards.length} with deadline estimate`,
    );
  }
  const pruned = pruneStaleListings(new Set(Object.keys(load().activeReactions)), now);
  if (pruned > 0) log.info(`overview sync pruned ${pruned} stale listing(s)`);
  const merged = readDb();
  return cards
    .map((card) => merged.listings[card.id])
    .filter((record): record is ListingRecord => Boolean(record));
}

/**
 * Update the DB from the reacties page AND reconcile the active-reaction
 * set against it (the authority). Open teasers confirm presence; anything
 * we believed active but SSH no longer lists is dropped.
 */
export function syncReactionSlots(
  slots: Array<{ id: string; status: string; title?: string; position?: number; total?: number }>,
  counters?: { openCount: number; limit: number },
): void {
  const now = Date.now();
  const openIds: string[] = [];
  for (const slot of slots) {
    if (slot.status !== "open") continue;
    openIds.push(slot.id);
    log.debug(
      `syncReactionSlots: ${slot.id} open, slot ${slot.position ?? "?"}/${slot.total ?? "?"}`,
    );
    upsertListing(
      slot.id,
      {
        url: `https://www.sshxl.nl/nl/aanbod/${slot.id}`,
        // Real teaser title only — never a fake placeholder, so an overview
        // record's real title is never clobbered.
        ...(slot.title ? { title: slot.title } : {}),
        lastSeenTs: now,
        status: "applied",
        statusTs: now,
        ...(slot.position !== undefined ? { slotPosition: slot.position } : {}),
        ...(slot.total !== undefined ? { slotTotal: slot.total } : {}),
      },
      "reacties",
    );
  }
  // Reacties teaser titles also teach us street/city options.
  const titled = slots
    .filter((slot) => slot.title)
    .map((slot) => parseListingTitle(slot.title ?? ""));
  recordKnownOptions(
    titled.map((t) => t.street),
    titled.map((t) => t.city),
  );
  reconcileWithReacties(openIds, counters?.openCount, counters?.limit);
}

/** What the user actually pays: rent after max huurtoeslag when known, else bruto. */
function effectiveRent(listing: ListingRecord): number | undefined {
  return listing.subsidyRent ?? listing.price;
}

/**
 * Why a listing is not eligible, for diagnostics. Mirrors the exact conditions
 * in buildSlotPlan so the log explains what the planner did.
 */
function exclusionReason(listing: ListingRecord, state: StoreState, now: number): string | null {
  if (state.activeReactions[listing.id]) return "active reaction (holds a slot)";
  if (listing.status === "applied") return "already applied";
  if (listing.status === "not-eligible") return "refused by the site";
  if (listing.status === "failed") return "failed earlier";
  if (listing.endsAtTs !== undefined && listing.endsAtTs <= now) return "deadline passed";

  const haystack = `${listing.street} ${listing.title}`.toLowerCase();
  if (state.filters.streetMode === "blacklist") {
    const hit = state.filters.blacklist.find((needle) => haystack.includes(needle.toLowerCase()));
    if (hit) return `blacklisted (matches "${hit}")`;
  } else if (
    state.filters.whitelist.length > 0 &&
    !state.filters.whitelist.some((needle) => haystack.includes(needle.toLowerCase()))
  ) {
    return `not in whitelist (${state.filters.whitelist.length} entries)`;
  }

  const prefs = state.preferences;
  if (
    prefs.cities?.length &&
    !prefs.cities.some((city) => city.toLowerCase() === listing.city.toLowerCase())
  )
    return `city "${listing.city}" not in [${prefs.cities.join(", ")}]`;
  const rent = effectiveRent(listing);
  if (prefs.maxRent !== undefined && rent !== undefined && rent > prefs.maxRent)
    return `effective rent €${rent} > max €${prefs.maxRent}`;
  if (
    prefs.minSurface !== undefined &&
    listing.surface !== undefined &&
    listing.surface < prefs.minSurface
  )
    return `surface ${listing.surface} m² < min ${prefs.minSurface} m²`;
  if (prefs.subsidyOnly && listing.subsidyRent === undefined) return "no huurtoeslag (subsidyOnly)";
  if (
    prefs.allocation?.length &&
    listing.allocation &&
    !prefs.allocation.includes(listing.allocation as "hospiteren" | "bezichtiging")
  )
    return `allocation ${listing.allocation} not wanted`;
  const dwellingType = listing.dwellingType;
  if (
    prefs.dwellingTypes?.length &&
    dwellingType &&
    !prefs.dwellingTypes.some((type) => dwellingType.toLowerCase().includes(type.toLowerCase()))
  )
    return `dwelling type "${dwellingType}" not wanted`;
  const contractType = listing.contractType;
  if (
    prefs.contractTypes?.length &&
    contractType &&
    !prefs.contractTypes.some((contract) =>
      contractType.toLowerCase().includes(contract.toLowerCase()),
    )
  )
    return `contract "${contractType}" not wanted`;
  return null;
}

/**
 * Build the fill plan: urgency-first among eligible listings, capped by free
 * slots. Whitelist is exclusive (only listed streets); blacklist excludes.
 * Logs a per-reason breakdown, and every excluded listing when nothing matches.
 */
export function buildSlotPlan(slotLimit: number, activeOpenReactions: number): Plan {
  const state = load();
  const now = Date.now();
  const all = Object.values(readDb().listings);
  const eligible: ListingRecord[] = [];
  const excluded: Array<{ id: string; title: string; reason: string }> = [];
  for (const listing of all) {
    const reason = exclusionReason(listing, state, now);
    if (reason) excluded.push({ id: listing.id, title: listing.title, reason });
    else eligible.push(listing);
  }
  eligible.sort((a, b) => (a.endsAtTs ?? Infinity) - (b.endsAtTs ?? Infinity));
  const freeSlots = Math.max(0, slotLimit - activeOpenReactions);

  const byReason = new Map<string, number>();
  for (const entry of excluded) byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);
  const breakdown = [...byReason.entries()].map(([reason, n]) => `${n}× ${reason}`).join(" · ");
  log.debug(
    `plan: ${all.length} tracked, ${eligible.length} eligible, ${excluded.length} excluded [${breakdown || "none"}] (${activeOpenReactions}/${slotLimit} slots used -> ${freeSlots} free)`,
  );
  if (eligible.length === 0 && excluded.length > 0) {
    log.debug(`plan: nothing eligible — excluded listings:`);
    for (const entry of excluded) log.debug(`  - ${entry.id} ${entry.title}: ${entry.reason}`);
  }
  return {
    activeCount: Math.min(activeOpenReactions, slotLimit),
    slotLimit,
    freeSlots,
    picks: eligible.slice(0, freeSlots),
  };
}
