/**
 * Scrapers for every page we understand, producing partial ListingRecords
 * and side data (profile, reaction slots). All regexes validated against
 * saved sshxl.nl fixtures.
 */

import { parseListingTitle } from "./listings";
import type { ListingRecord } from "./listings";
import type { Preferences } from "./storage";
import { sleep } from "../core/dom";
import { log } from "../core/logger";

// ------------------------------------------------------------------ overview

export interface OverviewCard {
  id: string;
  url: string;
  title: string;
  price?: number;
  subsidyRent?: number;
  rentStart?: string;
  surface?: number;
  dwellingType?: string;
  contractType?: string;
  allocation?: string;
  /** Estimated absolute deadline (ms epoch); exact value comes from the room page. */
  endsAtTs?: number;
}

function num(comma: string | undefined | null): number | undefined {
  if (!comma) return undefined;
  const value = Number.parseFloat(comma.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Card scraping runs against live DOM. The site renders both compact
 * ("2 dagen en 10 uur") and short ("10 uur") countdowns; both parsed.
 */
export function collectOverviewCards(): OverviewCard[] {
  return Array.from(document.querySelectorAll(".card--property"))
    .map((card): OverviewCard | null => {
      const href = card.querySelector(".card__link")?.getAttribute("href") ?? null;
      const id = href ? (/\/aanbod\/(\d+)/.exec(href)?.[1] ?? null) : null;
      if (!id || !href) return null;
      const text = (selector: string): string =>
        (card.querySelector(selector)?.textContent ?? "").replace(/\s+/g, " ").trim();
      const srValue = (label: string): string => {
        const spans = Array.from(card.querySelectorAll("span.sr-text"));
        const span = spans.find((el) =>
          el.textContent?.replace(/\s+/g, " ").trim().startsWith(label),
        );
        if (!span) return "";
        // value text follows the sr-text span inside the same li
        let node = span.nextSibling;
        let out = "";
        while (node) {
          if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? "";
          else break;
          node = node.nextSibling;
        }
        return out.replace(/\s+/g, " ").trim();
      };
      const hoursText = text(".card__footer p");
      return {
        id,
        url: new URL(href, location.origin).href,
        title: text(".card__title"),
        price: num(/€\s*([\d.,]+)\s*\/?mnd/.exec(text(".price-tag"))?.[1] ?? null),
        subsidyRent: num(srValue("Huur bij max.huurtoeslag").match(/€\s*([\d.,]+)/)?.[1] ?? null),
        rentStart: /huurperiode start op ([\d-]+)/.exec(text(".card__intro"))?.[1],
        surface: num(srValue("Oppervlakte").match(/^(\d+)/)?.[1] ?? null),
        dwellingType: srValue("Type woning") || undefined,
        contractType: srValue("Type contract") || undefined,
        allocation: srValue("Manier van toewijzing") || undefined,
        endsAtTs: estimateEndsAtFromText(hoursText),
      };
    })
    .filter((card): card is OverviewCard => card !== null);
}

/** "Er kan nog 2 dagen en 10 uur gereageerd worden." -> 58; "10 uur" -> 10. */
export function parseHours(text: string): number | undefined {
  const both = /(\d+)\s*dag(?:en)?\s*(?:en\s*(\d+)\s*)?uur/.exec(text);
  if (both) return Number(both[1]) * 24 + Number(both[2] ?? 0);
  const hours = /(\d+)\s*uur/.exec(text);
  if (hours) return Number(hours[1]);
  return undefined;
}

/**
 * Absolute deadline estimate from the overview countdown text.
 *   - clock forms ("vandaag om 23:59", "morgen om 23:59") -> exact timestamp
 *   - duration forms ("2 dagen en 10 uur", "10 uur") -> now + duration,
 *     rounded UP to the next hour. The site truncates the countdown; it is
 *     safer to overestimate than to expire a live listing early. The room
 *     page's exact deadline replaces this estimate when the room is visited.
 */
export function estimateEndsAtFromText(text: string, now: number = Date.now()): number | undefined {
  const clock = /(vandaag|morgen|overmorgen)\s+om\s+(\d{1,2}):(\d{2})/.exec(text);
  if (clock) {
    const offset = clock[1] === "vandaag" ? 0 : clock[1] === "morgen" ? 1 : 2;
    const date = new Date(now);
    date.setHours(Number(clock[2]), Number(clock[3]), 0, 0);
    date.setDate(date.getDate() + offset);
    return date.getTime();
  }
  const hours = parseHours(text);
  if (hours === undefined) {
    // A non-empty footer we cannot parse is a scraper gap worth knowing about.
    if (text.trim() !== "") log.debug(`estimateEndsAt: unparsable countdown text "${text.trim()}"`);
    return undefined;
  }
  return Math.ceil((now + hours * 3600_000) / 3600_000) * 3600_000;
}

export function cardToRecord(card: OverviewCard, now: number): Partial<ListingRecord> {
  const { street, city } = parseListingTitle(card.title);
  const record: Partial<ListingRecord> = {
    url: card.url,
    title: card.title,
    street,
    city,
    lastSeenTs: now,
  };
  if (card.price !== undefined) record.price = card.price;
  if (card.subsidyRent !== undefined) record.subsidyRent = card.subsidyRent;
  if (card.rentStart) record.rentStart = toIso(card.rentStart);
  if (card.surface !== undefined) record.surface = card.surface;
  if (card.dwellingType) record.dwellingType = card.dwellingType;
  if (card.contractType) record.contractType = card.contractType;
  if (card.allocation) record.allocation = card.allocation;
  if (card.endsAtTs !== undefined) record.endsAtTs = card.endsAtTs;
  return record;
}

/** "14-09-2026" -> "2026-09-14" */
function toIso(dutchDate: string): string {
  const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(dutchDate);
  if (!match) return dutchDate;
  const day = match[1] ?? "";
  const month = match[2] ?? "";
  const year = match[3] ?? "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// ------------------------------------------------------------------ room page

/**
 * Detail extraction from a room page. Returns only fields present; callers
 * merge into the listing DB.
 */
export function scrapeRoomPage(): Partial<ListingRecord> {
  const norm = normalize(document.body?.innerHTML ?? "");
  const grab = (pattern: RegExp): string | undefined => pattern.exec(norm)?.[1]?.trim();
  const detail: Partial<ListingRecord> = {};
  const deadline = /Tot (\d{1,2}-\d{1,2}-\d{4}) om (\d{1,2}:\d{2}) uur/.exec(norm);
  if (deadline) {
    const date = deadline[1];
    const time = deadline[2];
    if (date && time) {
      detail.deadlineIso = `${date} om ${time}`;
      detail.endsAtTs = dutchDeadlineToTs(date, time);
    }
  }
  const reactions = grab(/Aantal reacties:\s*<\/span>\s*(\d+)/);
  if (reactions) detail.reactionCount = Number(reactions);
  const position =
    /op plek\s*(?:<span class="sr-text">Huidige plek:<\/span>\s*)?(\d+)(?:\s*van\s*(\d+))?/.exec(
      norm,
    );
  if (position) {
    detail.slotPosition = Number(position[1]);
    if (position[2] !== undefined) detail.slotTotal = Number(position[2]);
  }
  const hospiteer = grab(/Hospiteren op ([^<]+?)<svg/);
  if (hospiteer) detail.hospiteerDate = hospiteer;
  const floor = grab(/Verdieping<\/dt><dd class="list__value">([^<]*)</);
  if (floor && /^\d+$/.test(floor)) detail.floor = Number(floor);
  const netto = grab(
    /Nettohuur<\/dt><dd class="list__value"><span class="price-label"><span class="euro">€<\/span><span>([\d,.]+)<\/span>/,
  );
  if (netto) detail.nettoRent = num(netto);
  const gender = grab(/<dt class="list__key">Geslacht<\/dt><dd class="list__value">([^<]*)</);
  if (gender) detail.genderPreference = gender;
  const smoking = grab(/Roken toegestaan<\/dt><dd class="list__value">([^<]*)</);
  if (smoking) detail.smokingAllowed = smoking === "Ja";
  const pets = grab(/Huisdieren toegestaan<\/dt><dd class="list__value">([^<]*)</);
  if (pets) detail.petsAllowed = pets === "Ja";
  const type = grab(/Type woonruimte<\/dt><dd class="list__value">([^<]*)</);
  if (type) {
    const housemates = /(\d+) huisgenoten/.exec(type);
    if (housemates) detail.housemates = Number(housemates[1]);
  }
  return detail;
}

function normalize(html: string): string {
  return html.replace(/\s+/g, " ");
}

/** "21-08-2026" + "23:59" (Dutch local time) -> ms epoch. */
function dutchDeadlineToTs(date: string, time: string): number | undefined {
  const d = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(date);
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!d || !t) return undefined;
  const ts = new Date(
    Number(d[3]),
    Number(d[2]) - 1,
    Number(d[1]),
    Number(t[1]),
    Number(t[2]),
  ).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

/** Hydration-aware room scrape; resolves with {} when nothing rendered. */
export function scrapeRoomPageWhenReady(timeoutMs = 15_000): Promise<Partial<ListingRecord>> {
  return scrapeWhenReady(
    () => {
      const detail = scrapeRoomPage();
      return Object.keys(detail).length > 0 ? detail : undefined;
    },
    "room details",
    timeoutMs,
  ).then((result) => result ?? {});
}

// ------------------------------------------------------------- reacties page

export interface ReactionSlot {
  id: string;
  status: string; // "open" | "closed" | ...
  /** Real listing title from the teaser (".teaser__title"), if present. */
  title?: string;
  position?: number;
  total?: number;
  countsTowardLimit: boolean;
}

/**
 * React renders these pages AFTER hydration; at document-end the content is
 * usually not there yet. Poll until the predicate finds something or time is
 * up. Every page scraper goes through this.
 */
export async function scrapeWhenReady<T>(
  probe: () => T | undefined,
  label: string,
  timeoutMs = 15_000,
): Promise<T | undefined> {
  const start = Date.now();
  for (;;) {
    const result = probe();
    if (result !== undefined) return result;
    if (Date.now() - start > timeoutMs) {
      log.warn(`scrape "${label}": content never appeared within ${timeoutMs}ms`);
      return undefined;
    }
    await sleep(400);
  }
}

/** Parse the reacties page teaser list + the open/limit counters. */
export function scrapeReactionSlots(): { slots: ReactionSlot[]; openCount: number; limit: number } {
  // DOM query, not innerHTML regex: the live React-rendered teasers carry the
  // class "teaser teaser--reaction-open"/"-closed" on an <article> (or any
  // element). Match the class substring so any reaction-teaser variant is
  // caught; read href + position within each.
  const articles = Array.from(
    document.querySelectorAll<HTMLElement>("[class*='teaser--reaction-']"),
  );
  const slots: ReactionSlot[] = [];
  for (const article of articles) {
    const status = /teaser--reaction-(\w+)/.exec(article.className)?.[1] ?? "";
    if (!status) continue;
    const href =
      article.querySelector("a[href*='/nl/mijn-ssh/reacties/']")?.getAttribute("href") ?? "";
    const id = /reacties\/(?:collective\/)?(\d+)/.exec(href)?.[1];
    if (!id) continue;
    const pos = /op plek (\d+) van (\d+)/.exec(article.textContent ?? "");
    const title =
      article
        .querySelector<HTMLElement>(".teaser__title, h4")
        ?.textContent?.replace(/\s+/g, " ")
        .trim() || undefined;
    slots.push({
      id,
      status,
      title,
      position: pos ? Number(pos[1]) : undefined,
      total: pos ? Number(pos[2]) : undefined,
      // collective/"gesloten" teasers explicitly do not count toward the limit
      countsTowardLimit: status !== "closed",
    });
  }
  if (slots.length > 0) {
    log.debug(
      `reacties scrape: ${slots.length} teasers, titles: ${slots
        .map((s) => `${s.id}=${s.title ?? "(none)"}`)
        .join(", ")}`,
    );
  }
  // Only flag a genuine structural failure (teaser elements present but NONE
  // parseable) — not the transient partial renders the count-stability probe
  // intentionally waits through.
  if (articles.length > 0 && slots.length === 0) {
    log.debug(`reacties scrape: ${articles.length} teaser elements but none parsed`);
  }
  const counters =
    /Je hebt op dit moment <em>(\d+)<\/em> lopende reactie\(s\)\. Je mag er in totaal\s*<em>(\d+)<\/em>/.exec(
      normalize(document.body?.innerHTML ?? ""),
    ) ?? undefined;
  return {
    slots,
    openCount: counters
      ? Number(counters[1])
      : slots.filter((slot) => slot.status === "open").length,
    limit: counters ? Number(counters[2]) : 7,
  };
}

/**
 * Hydration-aware variant: waits until the teaser list has FULLY rendered.
 * Two failure modes guarded here:
 *   - the "X open" counter renders before the teasers, so resolving on the
 *     counter syncs an empty list and wipes tracking via reconcile;
 *   - the teaser list itself renders progressively on the live site, so
 *     resolving on the first teaser captures a partial set.
 * We wait until the open-teaser count matches the counter AND the set is
 * stable across two consecutive polls. Resolves with empty data on timeout.
 */
export function scrapeReactionSlotsWhenReady(
  timeoutMs = 15_000,
): Promise<{ slots: ReactionSlot[]; openCount: number; limit: number }> {
  let lastCount = -1;
  let stablePolls = 0;
  return scrapeWhenReady(
    () => {
      const result = scrapeReactionSlots();
      if (result.slots.length === 0) {
        lastCount = -1;
        stablePolls = 0;
        return undefined;
      }
      const open = result.slots.filter((slot) => slot.status === "open").length;
      // The counter is authoritative about how many open reactions exist; a
      // smaller teaser count means the list is still rendering.
      if (result.openCount !== undefined && result.openCount > 0 && open < result.openCount) {
        return undefined;
      }
      // Settle: only resolve once the same set was seen twice in a row.
      if (lastCount === result.slots.length) stablePolls += 1;
      else {
        lastCount = result.slots.length;
        stablePolls = 0;
      }
      return stablePolls >= 1 ? result : undefined;
    },
    "reacties teasers",
    timeoutMs,
  ).then((result) => result ?? { slots: [], openCount: 0, limit: 7 });
}

// -------------------------------------------------------------------- profile

/**
 * Extract the matching-relevant profile fields. Two sources, tried in order:
 *   1. the app.portal_to payload script (structured, exact)
 *   2. the rendered <dl> fields (survives hydration; Dutch labels)
 */
export function scrapeProfile(): Preferences {
  const fromPayload = scrapeProfilePayload();
  if (Object.keys(fromPayload).length > 0) return fromPayload;
  return scrapeProfileVisible();
}

function scrapeProfilePayload(): Preferences {
  for (const script of Array.from(document.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    const start = text.indexOf("app.portal_to");
    if (start < 0) continue;
    const segment = text.slice(start, start + 8000).replace(/\s+/g, " ");
    const field = (key: string): string | undefined =>
      new RegExp(`${key}:\\s*"([^"]*)"`).exec(segment)?.[1];
    const numberField = (key: string): number | undefined => {
      const raw = new RegExp(`${key}:\\s*(\\d+)`).exec(segment)?.[1];
      return raw !== undefined ? Number(raw) : undefined;
    };
    const gender = field("Gender");
    const birth = field("DateOfBirth");
    const signUp = field("SignUpDate");
    const studiesStart = numberField("StudiesStartYear");
    return {
      ...(gender ? { gender } : {}),
      ...(birth ? { birthYear: Number(birth.slice(0, 4)) } : {}),
      ...(signUp ? { signUpDate: signUp.slice(0, 10) } : {}),
      ...(field("PrefferedCity") ? { preferredCity: field("PrefferedCity") } : {}),
      ...(field("EducationalAttainment") ? { education: field("EducationalAttainment") } : {}),
      ...(studiesStart !== undefined ? { studiesStartYear: studiesStart } : {}),
    };
  }
  return {};
}

/** Fallback: parse the rendered profile definition list. */
function scrapeProfileVisible(): Preferences {
  const values = new Map<string, string>();
  for (const item of document.querySelectorAll<HTMLElement>(
    ".list--specs .list__item, dl .list__item",
  )) {
    const key = item.querySelector("dt")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const dd = item.querySelector("dd");
    // Editable fields embed an action button ("Wijzig"); prefer the value
    // span when present so button labels never leak into the data.
    const value =
      dd?.querySelector(".editable__value")?.textContent ??
      dd?.querySelector("span")?.textContent ??
      dd?.textContent;
    if (key && value) values.set(key, value.replace(/\s+/g, " ").trim());
  }
  const pick = (prefix: string): string | undefined => {
    for (const [key, value] of values) {
      if (key.toLowerCase().startsWith(prefix.toLowerCase())) return value;
    }
    return undefined;
  };
  const gender = pick("Geslacht");
  const birthDutch = pick("Geboortedatum"); // e.g. "1 januari 1999"
  const signUpDutch = pick("Inschrijfdatum");
  const months = pick("Inschrijftijd"); // "42 maanden"
  const education = pick("Opleidingsniveau");

  const dutchMonths: Record<string, number> = {
    januari: 1,
    februari: 2,
    maart: 3,
    april: 4,
    mei: 5,
    juni: 6,
    juli: 7,
    augustus: 8,
    september: 9,
    oktober: 10,
    november: 11,
    december: 12,
  };
  const parseDutchDate = (text: string | undefined): string | undefined => {
    if (!text) return undefined;
    const match = /(\d+)\s+(\w+)\s+(\d{4})/.exec(text);
    if (!match) return undefined;
    const day = match[1];
    const monthName = match[2]?.toLowerCase();
    const year = match[3];
    if (!day || !monthName || !year) return undefined;
    const month = dutchMonths[monthName];
    if (month === undefined) return undefined;
    return `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
  };

  const birthIso = parseDutchDate(birthDutch);
  const signUpIso = parseDutchDate(signUpDutch);
  const studiesStart =
    months !== undefined
      ? new Date().getFullYear() - Math.round(Number.parseInt(months, 10) / 12)
      : undefined;

  return {
    ...(gender && !/neem contact/i.test(gender) ? { gender } : {}),
    ...(birthIso ? { birthYear: Number(birthIso.slice(0, 4)) } : {}),
    ...(signUpIso ? { signUpDate: signUpIso } : {}),
    ...(education ? { education } : {}),
    ...(studiesStart !== undefined && Number.isFinite(studiesStart)
      ? { studiesStartYear: studiesStart }
      : {}),
  };
}

/** Hydration-aware profile scrape: waits until either source yields data. */
export function scrapeProfileWhenReady(timeoutMs = 15_000): Promise<Preferences> {
  return scrapeWhenReady(
    () => {
      const result = scrapeProfile();
      return Object.keys(result).length > 0 ? result : undefined;
    },
    "profile fields",
    timeoutMs,
  ).then((result) => result ?? {});
}
