/**
 * Persistent state, backed by GM storage (Violentmonkey) with a localStorage
 * fallback. Schema v2 — hard drop of earlier versions; nothing was published.
 *
 * Shape:
 *   schemaVersion – 2
 *   quota         – max ACTIVE reactions at once (site limit is 7)
 *   listings      – listing database, see listings.ts
 *   preferences   – user profile snapshot + matching preferences
 *   filters       – street/building whitelist & blacklist
 */

import { log } from "../core/logger";

export interface Preferences {
  /** From profile page payload; used to prefill and to match requirements. */
  gender?: string; // "Man" | "Vrouw" | ... as reported by SSH
  birthYear?: number;
  signUpDate?: string; // ISO; registration duration matters for priority
  preferredCity?: string;
  education?: string;
  studiesStartYear?: number;
  // User-tunable matching preferences
  minSurface?: number; // m²
  maxRent?: number; // bruto per month
  subsidyOnly?: boolean; // only listings with huurtoeslag
  allocation?: Array<"hospiteren" | "bezichtiging">;
  cities?: string[];
  /** Dwelling types to apply to ("kamer"/"woning", lowercase substrings). */
  dwellingTypes?: string[];
  /** Contract types to apply to (e.g. "Campuscontract"). */
  contractTypes?: string[];
}

export interface Filters {
  /** Streets/buildings (lowercase substrings) that must be picked. */
  whitelist: string[];
  /** Streets/buildings (lowercase substrings) that are never picked. */
  blacklist: string[];
  /** Which street list is active: whitelist (only these) or blacklist (never
   * these). Only ONE list applies at a time — the other is preserved but
   * ignored, so the two can never conflict into an empty result. */
  streetMode: "whitelist" | "blacklist";
}

export interface QueueItem {
  id: string;
  url: string;
  title: string;
}

export interface RunState {
  /** Which flow owns the run; guards the applier vs the unreact runner. */
  kind: "apply" | "unreact";
  startedTs: number;
  lastNavTs: number;
  idx: number;
  queue: QueueItem[];
}

/** Listing database. The record type is injected to avoid a storage->listings
 * import cycle; listings.ts binds it to the full ListingRecord. */
export interface ListingsDb<R = unknown> {
  listings: Record<string, R>;
  schemaVersion: 2;
}

export interface ActiveReaction {
  sinceTs: number; // when we first believed this reaction open
  lastConfirmedTs: number; // last reacties-page visit that confirmed it
}

export interface StoreState {
  schemaVersion: 2;
  quota: number;
  db: ListingsDb<ListingDbShape>;
  /** The script's belief about currently-open reactions. Reconciled against
   * the authoritative reacties page and listing deadlines. */
  activeReactions: Record<string, ActiveReaction>;
  preferences: Preferences;
  filters: Filters;
  run: RunState | null;
  /** Streets and cities seen in listings over time (accumulated, never
   * pruned) — autocomplete options for the Settings tag lists. */
  knownStreets: string[];
  knownCities: string[];
  /** Options from the site's own filter dropdowns (type/contract). */
  knownDwellingTypes: string[];
  knownContractTypes: string[];
  /** Hub UI state (open/closed + selected tab), persisted across reloads. */
  hub: { open: boolean; tab: string };
}

/** Structural shape every stored listing record satisfies. listings.ts's
 * ListingRecord extends this. */
export interface ListingDbShape {
  id: string;
  status: string;
  statusTs: number;
  title?: string;
}

const STORE_KEY = "sshxl-autoapply-v2";
export const DEFAULT_QUOTA = 7;

export const DEFAULT_PREFERENCES: Preferences = {};
export const DEFAULT_FILTERS: Filters = { whitelist: [], blacklist: [], streetMode: "whitelist" };

type GMGetValue = (key: string) => unknown;
type GMSetValue = (key: string, value: unknown) => void;

declare const GM_getValue: GMGetValue | undefined;
declare const GM_setValue: GMSetValue | undefined;

function gmAvailable(): boolean {
  return typeof GM_getValue === "function" && typeof GM_setValue === "function";
}

function readRaw(): Partial<StoreState> {
  try {
    const raw = gmAvailable() ? GM_getValue?.(STORE_KEY) : localStorage.getItem(STORE_KEY);
    if (raw === null || raw === undefined) return {};
    return JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as Partial<StoreState>;
  } catch {
    return {};
  }
}

function writeRaw(state: StoreState): void {
  const json = JSON.stringify(state);
  if (gmAvailable()) GM_setValue?.(STORE_KEY, json);
  else localStorage.setItem(STORE_KEY, json);
}

let cache: StoreState | null = null;

export function load(): StoreState {
  if (cache) return cache;
  const partial = readRaw();
  const loaded: StoreState = {
    schemaVersion: 2,
    quota: typeof partial.quota === "number" ? partial.quota : DEFAULT_QUOTA,
    activeReactions: partial.activeReactions ?? {},
    db: partial.db ?? { listings: {}, schemaVersion: 2 },
    preferences: { ...DEFAULT_PREFERENCES, ...partial.preferences },
    filters: {
      whitelist: partial.filters?.whitelist ?? [],
      blacklist: partial.filters?.blacklist ?? [],
      streetMode: partial.filters?.streetMode === "blacklist" ? "blacklist" : "whitelist",
    },
    run: partial.run ? { ...partial.run, kind: partial.run.kind ?? "apply" } : null,
    knownStreets: Array.isArray(partial.knownStreets) ? partial.knownStreets : [],
    knownCities: Array.isArray(partial.knownCities) ? partial.knownCities : [],
    knownDwellingTypes: Array.isArray(partial.knownDwellingTypes) ? partial.knownDwellingTypes : [],
    knownContractTypes: Array.isArray(partial.knownContractTypes) ? partial.knownContractTypes : [],
    hub:
      partial.hub && typeof partial.hub.open === "boolean"
        ? {
            open: partial.hub.open,
            tab: typeof partial.hub.tab === "string" ? partial.hub.tab : "apply",
          }
        : { open: false, tab: "apply" },
  };
  cache = loaded;
  log.debug(
    `storage loaded (${gmAvailable() ? "GM" : "localStorage"}): ${Object.keys(loaded.db.listings).length} listings, ${Object.keys(loaded.activeReactions).length} active reactions, quota=${loaded.quota}`,
  );
  return loaded;
}

/** Persist. Call after every mutation; writes are tiny and infrequent. */
export function save(): void {
  if (!cache) return;
  writeRaw(cache);
}

export function mutate(fn: (state: StoreState) => void): void {
  const state = load();
  fn(state);
  save();
}

/** Wipe everything (schema change / fresh start). */
export function wipeAll(): void {
  cache = null;
  if (gmAvailable()) GM_setValue?.(STORE_KEY, "");
  else localStorage.removeItem(STORE_KEY);
}

/** Accumulate streets/cities/types/contracts seen (autocomplete options).
 * The option pool grows over time and is never pruned — a street not listed
 * today may be back tomorrow. */
export function recordKnownOptions(
  streets: string[],
  cities: string[],
  dwellingTypes: string[] = [],
  contractTypes: string[] = [],
): void {
  mutate((state) => {
    for (const street of streets) {
      const value = street.trim();
      if (value && !state.knownStreets.includes(value)) state.knownStreets.push(value);
    }
    for (const city of cities) {
      const value = city.trim();
      if (value && !state.knownCities.includes(value)) state.knownCities.push(value);
    }
    for (const type of dwellingTypes) {
      const value = type.trim();
      if (value && !state.knownDwellingTypes.includes(value)) state.knownDwellingTypes.push(value);
    }
    for (const contract of contractTypes) {
      const value = contract.trim();
      if (value && !state.knownContractTypes.includes(value)) state.knownContractTypes.push(value);
    }
  });
}
