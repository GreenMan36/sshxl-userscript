/**
 * Behavioral tests for the applier and unreact runner, with the site's
 * behavior MOCKED in-process (happy-dom): the header button, modal responses
 * and state flips are driven by the test, so every branch of the apply flow
 * is exercised deterministically — no browser, no static snapshots.
 *
 * The fake-timer clock drives waitFor() polling; DOM mutations simulate the
 * site's React responses (modal appears, header flips to "Bekijk mijn reactie").
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processRoom } from "../src/core/applier";
import { processUnreactPage } from "../src/core/unreact";
import { load, mutate, wipeAll } from "../src/data/storage";
import type { ListingRecord } from "../src/data/listings";

function loadFixture(name: string): string {
  return readFileSync(resolve(process.cwd(), "tests/fixtures", name), "utf8");
}

function q<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return el;
}

// happy-dom has no layout: the applier's modal-visibility check relies on
// getClientRects(); make every modal "visible" like a rendered one.
const RECT = { width: 1, height: 1, top: 0, left: 0, bottom: 1, right: 1 } as DOMRect;

beforeEach(() => {
  wipeAll();
  localStorage.clear();
  document.body.innerHTML = "";
  HTMLElement.prototype.getClientRects = (() => [RECT]) as unknown as () => DOMRectList;
  // happy-dom cannot navigate: the applier's end-of-run redirect to the
  // reacties page must be a no-op (location.pathname stays live for the
  // per-test pushState in startRun).
  Object.defineProperty(window.location, "assign", {
    configurable: true,
    writable: true,
    value: () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function startRun(ids: string[]): void {
  history.pushState({}, "", `/nl/aanbod/${ids[0]}-test`);
  mutate((s) => {
    s.run = {
      kind: "apply",
      startedTs: Date.now(),
      lastNavTs: Date.now(),
      idx: 0,
      queue: ids.map((id) => ({
        id,
        url: `https://www.sshxl.nl/nl/aanbod/${id}`,
        title: `Room ${id}`,
      })),
    };
  });
}

function confirmModal(buttonLabel: string): HTMLElement {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `<div class="modal__footer"><button class="button button--primary">${buttonLabel}</button></div>`;
  document.body.appendChild(modal);
  return modal;
}

describe("processRoom: happy path", () => {
  it("Reageer -> Bevestigen -> applied label records applied, holds a slot, finishes", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = loadFixture("room-header.html");
    startRun(["9001"]);

    const flow = processRoom();
    await vi.advanceTimersByTimeAsync(0); // header found on first poll

    q(".pageheader__actions button").click(); // user-facing: the site opens a modal
    confirmModal("Bevestigen");
    await vi.advanceTimersByTimeAsync(1000);

    q<HTMLButtonElement>(".modal .button--primary").click();
    q(".button__label").textContent = "Bekijk mijn reactie"; // site flips the header
    await vi.advanceTimersByTimeAsync(2000); // applied poll + end-of-run handoff sleep
    await flow;

    const state = load();
    expect(state.db.listings["9001"]?.status).toBe("applied");
    expect(state.activeReactions["9001"]).toBeDefined();
    expect(state.run).toBeNull();
  });
});

describe("processRoom: site refusal", () => {
  it("records not-eligible with the modal title", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = loadFixture("room-header.html");
    startRun(["9002"]);

    const flow = processRoom();
    await vi.advanceTimersByTimeAsync(0);

    q(".pageheader__actions button").click();
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML =
      '<header class="modal__header"><h2 class="modal__title">Niet mogelijk om te reageren</h2></header>' +
      '<div class="modal__footer"><button>Begrepen</button></div>';
    document.body.appendChild(modal);
    await vi.advanceTimersByTimeAsync(2000); // modal poll + end-of-run handoff sleep
    await flow;

    const state = load();
    const listing = state.db.listings["9002"] as ListingRecord | undefined;
    expect(listing?.status).toBe("not-eligible");
    expect(listing?.reason).toMatch(/niet mogelijk/i);
    expect(state.run).toBeNull();
  });
});

describe("processRoom: already applied", () => {
  it("skips and records applied when the header already shows it", async () => {
    document.body.innerHTML = loadFixture("room-header.html");
    q(".button__label").textContent = "Bekijk mijn reactie";
    startRun(["9003"]);

    await processRoom();

    expect(load().db.listings["9003"]?.status).toBe("applied");
    expect(load().run).toBeNull();
  });
});

describe("processRoom: header never appears", () => {
  it("marks the room failed after the timeout", async () => {
    vi.useFakeTimers();
    startRun(["9004"]); // empty body: no header button at all

    const flow = processRoom();
    await vi.advanceTimersByTimeAsync(32_000); // > T.headerButton (30s) + handoff sleep
    await flow;

    const state = load();
    expect(state.db.listings["9004"]?.status).toBe("failed");
    expect(state.run).toBeNull();
  });
});

describe("processUnreactPage: happy path", () => {
  it("withdraws via Intrekken, releases the slot, finishes the run", async () => {
    vi.useFakeTimers();
    history.pushState({}, "", "/nl/mijn-ssh/reacties/9501");
    mutate((s) => {
      s.run = {
        kind: "unreact",
        startedTs: Date.now(),
        lastNavTs: Date.now(),
        idx: 0,
        queue: [
          {
            id: "9501",
            url: "https://www.sshxl.nl/nl/mijn-ssh/reacties/9501",
            title: "Reaction 9501",
          },
        ],
      };
      s.activeReactions["9501"] = { sinceTs: Date.now(), lastConfirmedTs: Date.now() };
    });
    document.body.innerHTML = "<button>Reactie intrekken</button>";

    const flow = processUnreactPage();
    await vi.advanceTimersByTimeAsync(1000); // withdraw button found + clicked

    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML =
      '<div class="modal__footer"><button>Intrekken</button><button>Annuleren</button></div>';
    document.body.appendChild(modal);
    await vi.advanceTimersByTimeAsync(2000); // confirm + 1s settle sleep
    await flow;

    const state = load();
    expect(state.activeReactions["9501"]).toBeUndefined();
    expect(state.run).toBeNull();
  });
});
