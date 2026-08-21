/**
 * Scraper unit tests against REAL markup fragments extracted from the saved
 * sshxl.nl pages under tests/fixtures/ (see how those were mined in the
 * fixture headers). Any markup drift on the live site will show up here as a
 * failing extraction, long before the browser smoke.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import {
  cardToRecord,
  collectOverviewCards,
  estimateEndsAtFromText,
  parseHours,
  scrapeProfile,
  scrapeReactionSlots,
  scrapeReactionSlotsWhenReady,
  scrapeRoomPage,
} from "../src/data/scrapers";
import { parseListingTitle } from "../src/data/listings";

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), "tests/fixtures", name), "utf8");
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("countdown parsing", () => {
  it("parses every duration form the site uses", () => {
    expect(parseHours("Er kan nog 2 dagen en 10 uur gereageerd worden.")).toBe(58);
    expect(parseHours("Er kan nog 1 dag en 10 uur gereageerd worden.")).toBe(34);
    expect(parseHours("Er kan nog 10 uur gereageerd worden.")).toBe(10);
    expect(parseHours("")).toBeUndefined();
  });

  it("rounds duration estimates UP to the next hour (never expire early)", () => {
    const now = new Date(2026, 7, 21, 12, 30, 0).getTime();
    const est = estimateEndsAtFromText("Er kan nog 10 uur gereageerd worden.", now);
    expect(est).toBe(Math.ceil((now + 10 * 3600_000) / 3600_000) * 3600_000);
  });

  it("parses clock forms exactly", () => {
    const now = new Date(2026, 7, 21, 12, 30, 0).getTime();
    const today = new Date(now);
    today.setHours(23, 59, 0, 0);
    expect(estimateEndsAtFromText("vandaag om 23:59", now)).toBe(today.getTime());
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    expect(estimateEndsAtFromText("morgen om 10:00", now)).toBe(tomorrow.getTime());
  });
});

describe("overview card scraping (real markup)", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("overview-cards.html");
  });

  it("extracts every card with id, title, price and deadline estimate", () => {
    const cards = collectOverviewCards();
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.id).toMatch(/^\d+$/);
      expect(card.title).toBeTruthy();
      expect(card.price).toBeTypeOf("number");
      expect(card.endsAtTs).toBeTypeOf("number");
    }
    expect(cards.map((c) => c.id)).toContain("1477612");
  });

  it("splits street/city and carries the estimate into a record", () => {
    const card = collectOverviewCards()[0];
    if (!card) throw new Error("no card");
    const record = cardToRecord(card, Date.now());
    const { street, city } = parseListingTitle(card.title);
    expect(record.street).toBe(street);
    expect(record.city).toBe(city);
    expect(record.endsAtTs).toBe(card.endsAtTs);
  });
});

describe("room detail scraping (real markup)", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("room-detail.html");
  });

  it("captures the exact deadline, position, counts and specs", () => {
    const detail = scrapeRoomPage();
    expect(detail.deadlineIso).toBe("21-08-2026 om 23:59");
    expect(detail.endsAtTs).toBe(new Date(2026, 7, 21, 23, 59).getTime());
    expect(detail.reactionCount).toBe(87);
    expect(detail.slotPosition).toBe(8);
    expect(detail.housemates).toBe(4);
    expect(detail.floor).toBe(13);
    expect(detail.nettoRent).toBe(611.28);
    expect(detail.genderPreference).toBe("Geen voorkeur");
    expect(detail.smokingAllowed).toBe(false);
    expect(detail.petsAllowed).toBe(false);
  });
});

describe("reacties scraping (real markup)", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("reacties.html");
  });

  it("parses 6 open + 1 closed teasers with positions and the counter", () => {
    const { slots, openCount, limit } = scrapeReactionSlots();
    expect(limit).toBe(7);
    expect(openCount).toBe(6);
    expect(slots).toHaveLength(7);

    const open = slots.filter((s) => s.status === "open");
    expect(open).toHaveLength(6);
    const sample = open.find((s) => s.id === "1477573");
    expect(sample?.position).toBe(5);
    expect(sample?.total).toBe(98);
    // Real teaser titles are captured (never "Listing N" placeholders).
    for (const slot of open) {
      expect(slot.title).toBeTruthy();
      expect(slot.title).not.toMatch(/^Listing \d+$/);
    }

    const closed = slots.find((s) => s.status === "closed");
    expect(closed?.id).toBe("551");
    expect(closed?.countsTowardLimit).toBe(false);
  });

  it("waits for teasers when only the counter has rendered (live hydration order)", async () => {
    vi.useFakeTimers();
    // The real page renders the "X open" counter before the teaser list. The
    // whenReady probe must NOT resolve on the counter alone, or it would sync
    // an empty slot list and wipe tracking (the reported bug).
    document.body.innerHTML =
      "<p>Je hebt op dit moment <em>6</em> lopende reactie(s). Je mag er in totaal <em>7</em> hebben.</p>";
    const promise = scrapeReactionSlotsWhenReady();
    // Teasers render after hydration.
    document.body.innerHTML += loadFixture("reacties.html");
    await vi.advanceTimersByTimeAsync(1200);
    const result = await promise;
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.openCount).toBe(6);
    expect(result.slots.filter((s) => s.status === "open")).toHaveLength(6);
  });
});

describe("profile scraping (real app.portal_to payload)", () => {
  beforeEach(() => {
    document.body.innerHTML = loadFixture("profile.html");
  });

  it("extracts gender, birth year and signup date", () => {
    const prefs = scrapeProfile();
    expect(prefs.gender).toBe("Man");
    expect(prefs.birthYear).toBe(1999);
    expect(prefs.signUpDate).toBe("2020-01-01");
  });
});
