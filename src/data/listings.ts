/**
 * Listing database: every listing the script has ever seen, keyed by SSH
 * listing id. Records are merged from three sources of increasing detail:
 *   1. overview cards  (cheap, refreshed on every overview visit)
 *   2. room pages      (exact deadline, reaction count, position, requirements)
 *   3. reacties page   (authoritative application status + slot position)
 *
 * Merges are FIELD-LEVEL: each source only writes the fields it owns, so a
 * less-authoritative page can never downgrade a field a more authoritative
 * page already filled. Ownership map: FIELD_OWNERSHIP below.
 *
 * Deadlines: the overview only shows a countdown ("2 dagen en 10 uur"), which
 * we convert to an absolute end timestamp (endsAtTs) at scrape time, rounded
 * UP so a live listing is never expired early. The room page's exact
 * "Tot dd-mm-yyyy om HH:mm" overrides the estimate forever after.
 *
 * Schema v2 (hard drop of earlier versions; nothing published).
 */

import { load, save } from "./storage";
import type { ListingsDb } from "./storage";
import { log } from "../core/logger";

export interface ListingRecord {
  id: string;
  url: string;

  // ---- from overview card
  title: string; // "Cambridgelaan 787 k3, Utrecht"
  street: string; // "Cambridgelaan 787 k3"
  city: string; // "Utrecht"
  price?: number; // bruto huur per month
  subsidyRent?: number; // rent after max huurtoeslag
  rentStart?: string; // ISO date
  surface?: number; // m²
  dwellingType?: string; // "kamer" | "woning" | raw text
  contractType?: string; // "Campuscontract" etc.
  allocation?: string; // "hospiteren" | "bezichtiging"
  lastSeenTs: number; // last time any page confirmed this listing exists

  // ---- deadline (overview estimate, replaced by exact room deadline)
  /** Absolute end of the reaction window (ms epoch). Estimate from the
   * overview countdown (rounded up), or exact when the room page was seen. */
  endsAtTs?: number;

  // ---- from room page (detail), filled when visited
  detailTs?: number;
  /** Exact "Tot 21-08-2026 om 23:59" as shown on the room page. */
  deadlineIso?: string;
  reactionCount?: number; // "Aantal reacties" on the room page
  hospiteerDate?: string;
  floor?: number;
  nettoRent?: number;
  genderPreference?: string; // "Geen voorkeur" | "Man" | "Vrouw" | ...
  smokingAllowed?: boolean;
  petsAllowed?: boolean;
  housemates?: number; // parsed from "Een kamer met 4 huisgenoten"

  // ---- application lifecycle (from reacties page or our own runs)
  status: ListingStatus;
  statusTs: number;
  /** Modal title when the site refused the reaction (status not-eligible). */
  reason?: string;
  /** Position snapshot: "plek 8" on the room page, "plek 8 van 95" on the
   * reacties teaser. Both pages are authoritative; the fresher write wins. */
  slotPosition?: number;
  slotTotal?: number;
}

export type ListingStatus =
  | "new" // seen on overview, never applied
  | "applied" // confirmed active reaction (reacties page or verified run)
  | "unknown" // submitted but never confirmed; costs no slot until proven
  | "failed" // could not apply (timeout/missing button); reason recorded, not retried
  | "not-eligible"; // site refused permanently

/** Source of a listing patch; determines which fields it may write. */
export type ListingSource = "overview" | "room" | "reacties" | "run";

/**
 * Field ownership per source. A source only ever writes the fields it owns;
 * the merge in upsertListing applies that filter. Notably:
 *   - overview never writes status (a card cannot know our application state)
 *   - reacties writes status/slot position + the teaser's real title/url
 *   - the exact room deadline wins over an overview estimate
 */
const FIELD_OWNERSHIP: Record<ListingSource, readonly (keyof ListingRecord)[]> = {
  overview: [
    "url",
    "title",
    "street",
    "city",
    "price",
    "subsidyRent",
    "rentStart",
    "surface",
    "dwellingType",
    "contractType",
    "allocation",
    "endsAtTs",
    "lastSeenTs",
  ],
  room: [
    "endsAtTs",
    "deadlineIso",
    "detailTs",
    "reactionCount",
    "slotPosition",
    "slotTotal",
    "status",
    "hospiteerDate",
    "floor",
    "nettoRent",
    "genderPreference",
    "smokingAllowed",
    "petsAllowed",
    "housemates",
    "lastSeenTs",
  ],
  reacties: ["status", "statusTs", "slotPosition", "slotTotal", "lastSeenTs", "url", "title"],
  run: ["status", "statusTs", "reason"],
};

export function parseListingTitle(title: string): { street: string; city: string } {
  const comma = title.lastIndexOf(",");
  if (comma < 0) return { street: title.trim(), city: "" };
  return { street: title.slice(0, comma).trim(), city: title.slice(comma + 1).trim() };
}

/**
 * Read-modify-write a single listing record. `patch` is filtered to the
 * fields `source` owns, so authority conflicts always resolve in favor of the
 * more authoritative page. Higher-authority writes overwrite; a lower-authority
 * source can never downgrade a field it does not own.
 */
export function upsertListing(
  id: string,
  patch: Partial<ListingRecord>,
  source: ListingSource = "run",
): void {
  mutateStore((db) => {
    const existing = (db.listings[id] ?? {}) as Partial<ListingRecord>;
    const isNew = !existing.id;
    const owned = FIELD_OWNERSHIP[source];
    const applied: Record<string, unknown> = {};
    const filtered: string[] = [];
    for (const key of Object.keys(patch)) {
      const field = key as keyof ListingRecord;
      if (!owned.includes(field)) {
        filtered.push(key);
        continue; // this source does not own the field
      }
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      // The exact room deadline outranks any overview countdown estimate.
      if (source === "overview" && field === "endsAtTs" && existing.deadlineIso) {
        log.debug(
          `listings: ${id} overview deadline estimate ignored (exact ${existing.deadlineIso})`,
        );
        continue;
      }
      // The room header can only ever confirm "applied" ("Bekijk mijn reactie");
      // it must never downgrade lifecycle state.
      if (source === "room" && field === "status" && value !== "applied") continue;
      applied[key] = value;
    }
    if (filtered.length > 0) {
      log.debug(
        `listings: ${id} patch(${source}) dropped fields not owned: ${filtered.join(", ")}`,
      );
    }
    const merged = {
      ...existing,
      ...(applied as Partial<ListingRecord>),
      id,
    } as ListingRecord;
    // Required fields must never become undefined via a partial patch.
    merged.url = merged.url ?? `https://www.sshxl.nl/nl/aanbod/${id}`;
    merged.title = merged.title ?? `Listing ${id}`;
    merged.street = merged.street ?? "";
    merged.city = merged.city ?? "";
    merged.status = merged.status ?? "new";
    merged.statusTs = merged.statusTs ?? Date.now();
    merged.lastSeenTs = merged.lastSeenTs ?? Date.now();
    if (isNew) log.debug(`listings: new record ${id} created by ${source}`);
    else if (merged.status !== existing.status)
      log.debug(`listings: ${id} status ${existing.status ?? "?"} -> ${merged.status} (${source})`);
    db.listings[id] = merged;
  });
}

/** Hours until the (estimated or exact) deadline; undefined when unknown. */
export function hoursLeft(listing: ListingRecord, now: number = Date.now()): number | undefined {
  if (listing.endsAtTs === undefined) return undefined;
  return Math.max(0, (listing.endsAtTs - now) / 3600_000);
}

const THIRTY_DAYS_MS = 30 * 24 * 3600_000;

/**
 * Drop records that have not been seen for `retentionMs` (default 30 days)
 * and do not currently hold an active reaction. History is cheap, but the
 * database must not grow forever; active reactions are never pruned because
 * the slot model keys off them.
 */
export function pruneStaleListings(
  activeIds: ReadonlySet<string>,
  now: number = Date.now(),
  retentionMs: number = THIRTY_DAYS_MS,
): number {
  let removed = 0;
  mutateStore((db) => {
    for (const [id, listing] of Object.entries(db.listings)) {
      if (activeIds.has(id)) continue;
      if (now - (listing.lastSeenTs ?? 0) > retentionMs) {
        delete db.listings[id];
        removed += 1;
      }
    }
  });
  return removed;
}

function mutateStore(fn: (db: ListingsDb<ListingRecord>) => void): void {
  const state = load();
  const db: ListingsDb<ListingRecord> = readDb();
  fn(db);
  state.db = db;
  save();
}

export function readDb(): ListingsDb<ListingRecord> {
  const state = load();
  const db = state.db;
  if (db && typeof db === "object" && "listings" in db) {
    return db as ListingsDb<ListingRecord>;
  }
  return { listings: {}, schemaVersion: 2 };
}

export function getListing(id: string): ListingRecord | undefined {
  return readDb().listings[id];
}
