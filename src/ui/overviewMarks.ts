/**
 * Mark listings on the /aanbod overview with a status badge so it is obvious
 * which rooms we have already applied to, were refused for, or failed to
 * apply to. Badges are injected into the site's cards and re-applied whenever
 * React re-renders the list (MutationObserver, debounced).
 */

import { readDb } from "../data/listings";
import { load } from "../data/storage";

const APPLIED_COLOR = "#2e7d32";
const REFUSED_COLOR = "#c62828";
const FAILED_COLOR = "#e65100";

function getBadge(card: HTMLElement): HTMLElement {
  let badge = card.querySelector<HTMLElement>("[data-sshxl-badge]");
  if (!badge) {
    card.style.position = "relative";
    badge = document.createElement("div");
    badge.setAttribute("data-sshxl-badge", "");
    Object.assign(badge.style, {
      position: "absolute",
      top: "8px",
      right: "8px",
      zIndex: "5",
      padding: "2px 8px",
      borderRadius: "999px",
      color: "#fff",
      fontSize: "11px",
      fontWeight: "700",
      boxShadow: "0 2px 6px rgba(0,0,0,.3)",
    });
    card.appendChild(badge);
  }
  return badge;
}

/** Re-read the DB and badge every .card--property on the overview. */
export function markOverviewCards(): void {
  if (!/\/nl\/aanbod/.test(location.pathname)) return;
  const listings = readDb().listings;
  // "Applied" tracks the LIVE slot state (activeReactions), not the historical
  // status — so a withdrawn/closed reaction immediately unmarks the card.
  const active = load().activeReactions;
  for (const card of Array.from(document.querySelectorAll<HTMLElement>(".card--property"))) {
    const href = card.querySelector(".card__link")?.getAttribute("href") ?? "";
    const id = /\/aanbod\/(\d+)/.exec(href)?.[1];
    const listing = id ? listings[id] : undefined;
    const badge = listing ? getBadge(card) : null;

    let label: string | undefined;
    let color: string | undefined;
    if (listing && id && active[id]) {
      label = "Applied";
      color = APPLIED_COLOR;
    } else if (listing?.status === "not-eligible") {
      label = "Refused";
      color = REFUSED_COLOR;
    } else if (listing?.status === "failed") {
      label = "Failed";
      color = FAILED_COLOR;
    }

    if (label && badge) {
      badge.textContent = label;
      badge.style.background = color ?? "#333";
      badge.style.display = "";
      badge.title = listing?.reason ?? "";
      continue;
    }
    if (badge) badge.style.display = "none";
  }
}

let observer: MutationObserver | null = null;
let debounce: number | undefined;

/** Start watching the overview's card list; call once at startup. */
export function initOverviewMarks(): void {
  if (observer) return;
  const schedule = (): void => {
    if (debounce) window.clearTimeout(debounce);
    debounce = window.setTimeout(markOverviewCards, 200);
  };
  observer = new MutationObserver(schedule);
  observer.observe(document, { subtree: true, childList: true });
  markOverviewCards();
}
