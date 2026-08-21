/**
 * State-model tests: field-level authority merge, deadline helpers, pruning
 * and planner eligibility/sort. No DOM needed — pure storage logic.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ListingRecord } from "../src/data/listings";
import { getListing, hoursLeft, pruneStaleListings, upsertListing } from "../src/data/listings";
import { load, mutate, recordKnownOptions, wipeAll } from "../src/data/storage";
import { buildSlotPlan, filterFunnel } from "../src/data/planner";
import { markReactionInactive } from "../src/data/reactions";

beforeEach(() => {
  wipeAll();
  localStorage.clear();
});

describe("field-level authority merge", () => {
  it("overview can never write status", () => {
    upsertListing(
      "1",
      { title: "Cambridgelaan 787 k3, Utrecht", status: "applied", statusTs: 42 },
      "overview",
    );
    expect(getListing("1")?.status).toBe("new");
  });

  it("overview re-sync preserves a run status and reason", () => {
    upsertListing("2", { title: "X, Utrecht" }, "overview");
    upsertListing("2", { status: "not-eligible", reason: "Niet mogelijk om te reageren" }, "run");
    upsertListing("2", { title: "X, Utrecht" }, "overview");
    expect(getListing("2")?.status).toBe("not-eligible");
    expect(getListing("2")?.reason).toBe("Niet mogelijk om te reageren");
  });

  it("reacties writes its teaser title (authoritative) + status + slot", () => {
    upsertListing("3", { title: "Real Title, Utrecht" }, "overview");
    upsertListing(
      "3",
      {
        title: "Cambridgelaan 787 k3, Utrecht",
        status: "applied",
        statusTs: 5,
        slotPosition: 5,
        slotTotal: 98,
      },
      "reacties",
    );
    const listing = getListing("3");
    expect(listing?.title).toBe("Cambridgelaan 787 k3, Utrecht");
    expect(listing?.status).toBe("applied");
    expect(listing?.slotPosition).toBe(5);
    expect(listing?.slotTotal).toBe(98);
  });

  it("reacties placeholder fills records we have never seen", () => {
    upsertListing(
      "4",
      { title: "Listing 4", street: "", city: "", status: "applied", statusTs: 5 },
      "reacties",
    );
    expect(getListing("4")?.title).toBe("Listing 4");
    expect(getListing("4")?.status).toBe("applied");
  });

  it("room exact deadline beats any later overview estimate", () => {
    upsertListing("5", { endsAtTs: 9999, title: "Y, Utrecht" }, "overview");
    upsertListing("5", { deadlineIso: "21-08-2026 om 23:59", endsAtTs: 1000 }, "room");
    upsertListing("5", { endsAtTs: 7777 }, "overview");
    const listing = getListing("5");
    expect(listing?.endsAtTs).toBe(1000);
    expect(listing?.deadlineIso).toBe("21-08-2026 om 23:59");
  });

  it("room writes detail fields + applied status, never title or other statuses", () => {
    upsertListing("6", { title: "Z, Utrecht" }, "overview");
    upsertListing(
      "6",
      { reactionCount: 87, slotPosition: 8, status: "applied", title: "HACKED" },
      "room",
    );
    let listing = getListing("6");
    expect(listing?.reactionCount).toBe(87);
    expect(listing?.slotPosition).toBe(8);
    expect(listing?.status).toBe("applied");
    expect(listing?.title).toBe("Z, Utrecht");
    // The room header can only ever confirm applied; it must not downgrade.
    upsertListing("6", { status: "failed" }, "room");
    listing = getListing("6");
    expect(listing?.status).toBe("applied");
  });
});

describe("deadline helpers", () => {
  it("hoursLeft derives from endsAtTs", () => {
    const now = Date.now();
    upsertListing("7", { endsAtTs: now + 3 * 3600_000 }, "overview");
    const listing = getListing("7");
    expect(listing).toBeDefined();
    expect(hoursLeft(listing as ListingRecord, now)).toBeCloseTo(3, 9);
  });
});

describe("pruning", () => {
  it("drops records unseen past retention but never active ones", () => {
    const now = Date.now();
    const monthAgo = now - 40 * 24 * 3600_000;
    upsertListing("old", { lastSeenTs: monthAgo }, "overview");
    upsertListing("active", { lastSeenTs: monthAgo }, "overview");
    upsertListing("fresh", { lastSeenTs: now }, "overview");
    const removed = pruneStaleListings(new Set(["active"]), now);
    expect(removed).toBe(1);
    expect(getListing("old")).toBeUndefined();
    expect(getListing("active")).toBeDefined();
    expect(getListing("fresh")).toBeDefined();
  });
});

describe("known options", () => {
  it("accumulates streets/cities and never duplicates or prunes", () => {
    recordKnownOptions(["Cambridgelaan 787 k3", "Elzas 41"], ["Utrecht", "Zeist"]);
    recordKnownOptions(["Cambridgelaan 787 k3"], ["Utrecht"]);
    const state = load();
    expect(state.knownStreets).toEqual(["Cambridgelaan 787 k3", "Elzas 41"]);
    expect(state.knownCities).toEqual(["Utrecht", "Zeist"]);
  });
});

describe("planner", () => {
  it("excludes expired/refused/applied/active and sorts by endsAtTs", () => {
    const now = Date.now();
    upsertListing("u1", { endsAtTs: now + 3600_000, title: "U1, Utrecht" }, "overview");
    upsertListing("u2", { endsAtTs: now + 24 * 3600_000, title: "U2, Utrecht" }, "overview");
    upsertListing("nodeadline", { title: "ND, Utrecht" }, "overview");
    upsertListing("expired", { endsAtTs: now - 1000, title: "EX, Utrecht" }, "overview");
    upsertListing("refused", { status: "not-eligible", title: "R, Utrecht" }, "run");
    upsertListing("failed", { status: "failed", title: "FA, Utrecht" }, "run");
    upsertListing("applied", { status: "applied", title: "AP, Utrecht" }, "run");
    mutate((s) => {
      s.activeReactions.active = { sinceTs: now, lastConfirmedTs: now };
    });

    const plan = buildSlotPlan(7, 1);
    expect(plan.picks.map((p) => p.id)).toEqual(["u1", "u2", "nodeadline"]);
    expect(plan.picks[0]?.endsAtTs).toBe(now + 3600_000);
    expect(plan.freeSlots).toBe(6);
    expect(load().activeReactions.active).toBeDefined();
  });

  it("never picks an applied listing even when activeReactions is empty", () => {
    upsertListing("applied", { status: "applied", title: "AP, Utrecht" }, "run");
    upsertListing("fresh", { title: "FR, Utrecht" }, "overview");

    const plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id)).toEqual(["fresh"]);
  });

  it("whitelist is exclusive: only whitelisted streets are picked", () => {
    upsertListing(
      "cambridge",
      { title: "Cambridgelaan 787 k3, Utrecht", street: "Cambridgelaan 787 k3", city: "Utrecht" },
      "overview",
    );
    upsertListing(
      "elzas",
      { title: "Elzas 41, Utrecht", street: "Elzas 41", city: "Utrecht" },
      "overview",
    );
    mutate((s) => {
      s.filters.whitelist = ["cambridgelaan"];
    });

    const plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id)).toEqual(["cambridge"]);
  });

  it("only the ACTIVE street mode applies: blacklist mode ignores the whitelist", () => {
    upsertListing(
      "cambridge",
      { title: "Cambridgelaan 787 k3, Utrecht", street: "Cambridgelaan 787 k3", city: "Utrecht" },
      "overview",
    );
    upsertListing(
      "elzas",
      { title: "Elzas 41, Utrecht", street: "Elzas 41", city: "Utrecht" },
      "overview",
    );
    mutate((s) => {
      // In whitelist mode "elzas" would exclude cambridge; in blacklist mode
      // the whitelist is ignored, and the blacklist excludes nothing.
      s.filters.whitelist = ["elzas"];
      s.filters.blacklist = [];
      s.filters.streetMode = "blacklist";
    });

    const plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id).sort()).toEqual(["cambridge", "elzas"].sort());
  });

  it("whitelist mode ignores the blacklist (no conflicting empty result)", () => {
    upsertListing(
      "cambridge",
      { title: "Cambridgelaan 787 k3, Utrecht", street: "Cambridgelaan 787 k3", city: "Utrecht" },
      "overview",
    );
    mutate((s) => {
      s.filters.whitelist = ["cambridgelaan"];
      s.filters.blacklist = ["cambridgelaan"];
      s.filters.streetMode = "whitelist";
    });

    // Even though the street is also blacklisted, whitelist mode ignores it.
    const plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id)).toEqual(["cambridge"]);
  });

  it("city matching is case-insensitive (lowercase stored entries still match)", () => {
    upsertListing(
      "cambridge",
      { title: "Cambridgelaan 787 k3, Utrecht", street: "Cambridgelaan 787 k3", city: "Utrecht" },
      "overview",
    );
    upsertListing(
      "elzas",
      { title: "Elzas 41, Rotterdam", street: "Elzas 41", city: "Rotterdam" },
      "overview",
    );
    mutate((s) => {
      s.preferences.cities = ["utrecht"]; // as old tag entries were stored
    });

    const plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id)).toEqual(["cambridge"]);
  });

  it("filters by dwelling type and contract type", () => {
    upsertListing(
      "kamer",
      {
        title: "A, Utrecht",
        street: "A",
        city: "Utrecht",
        dwellingType: "kamer",
        contractType: "Campuscontract",
      },
      "overview",
    );
    upsertListing(
      "woning",
      {
        title: "B, Utrecht",
        street: "B",
        city: "Utrecht",
        dwellingType: "zelfstandige woning",
        contractType: "Jongerencontract",
      },
      "overview",
    );
    mutate((s) => {
      s.preferences.dwellingTypes = ["kamer"];
    });

    let plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id)).toEqual(["kamer"]);

    mutate((s) => {
      s.preferences.dwellingTypes = undefined;
      s.preferences.contractTypes = ["campuscontract"]; // case-insensitive
    });
    plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id)).toEqual(["kamer"]);
  });

  it("max rent compares the rent AFTER huurtoeslag when known", () => {
    // Bruto 755, but only 280 after max huurtoeslag: should pass a €500 cap.
    upsertListing(
      "subsidised",
      { title: "S, Utrecht", street: "S", city: "Utrecht", price: 755, subsidyRent: 280 },
      "overview",
    );
    upsertListing(
      "nosubsidy",
      { title: "N, Utrecht", street: "N", city: "Utrecht", price: 600 },
      "overview",
    );
    mutate((s) => {
      s.preferences.maxRent = 500;
    });

    const plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id)).toEqual(["subsidised"]);
  });

  it("filterFunnel reports cumulative remaining counts per stage", () => {
    upsertListing(
      "a",
      { title: "A, Utrecht", street: "A", city: "Utrecht", price: 800, surface: 20 },
      "overview",
    );
    upsertListing(
      "b",
      { title: "B, Groningen", street: "B", city: "Groningen", price: 400, surface: 10 },
      "overview",
    );
    upsertListing(
      "c",
      { title: "C, Utrecht", street: "C", city: "Utrecht", price: 400, surface: 20 },
      "overview",
    );
    upsertListing("applied", { status: "applied" }, "run"); // not actionable
    mutate((s) => {
      s.preferences.cities = ["Utrecht"];
      s.preferences.maxRent = 500;
    });

    const funnel = filterFunnel();
    expect(funnel.total).toBe(3);
    expect(funnel.steps.map((step) => step.label)).toEqual([
      "Cities",
      "Max rent (after huurtoeslag)",
    ]);
    // Cities: 3 -> 2 (Groningen removed); Max rent: 2 -> 1 (a is €800).
    expect(funnel.steps[0]?.removed).toBe(1);
    expect(funnel.steps[0]?.remaining).toBe(2);
    expect(funnel.steps[1]?.removed).toBe(1);
    expect(funnel.steps[1]?.remaining).toBe(1);
    expect(funnel.eligible).toBe(1);
  });

  it("unreacting resets a listing to re-applicable so freed slots can refill", () => {
    upsertListing("9", { status: "applied", statusTs: 1, title: "W, Utrecht" }, "run");
    mutate((s) => {
      s.activeReactions["9"] = { sinceTs: 1, lastConfirmedTs: 1 };
    });

    markReactionInactive("9", "withdrawn by user/run");

    expect(load().activeReactions["9"]).toBeUndefined();
    expect(getListing("9")?.status).toBe("new");
    // The freed slot can now be filled with the room we just unapplied.
    const plan = buildSlotPlan(7, 0);
    expect(plan.picks.map((p) => p.id)).toContain("9");
  });
});
