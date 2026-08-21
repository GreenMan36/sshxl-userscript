/**
 * Page classification and room-header helpers.
 * Card scraping lives in scrapers.ts (collectOverviewCards).
 */

export type PageKind = "overview" | "room" | "reacties" | "other";

export function pageKind(pathname: string = location.pathname): PageKind {
  if (/\/nl\/aanbod\/?$/.test(pathname)) return "overview";
  if (listingId(pathname) !== null) return "room";
  if (/\/nl\/mijn-ssh\/reacties/.test(pathname)) return "reacties";
  return "other";
}

export function listingId(pathname: string = location.pathname): string | null {
  const match = pathname.match(/\/aanbod\/(\d+)/);
  return match?.[1] ?? null;
}

/**
 * The header button doubles as the applied-state oracle:
 *   open   -> "Reageer op deze kamer" / "Reageer op deze woning"
 *   applied-> "Bekijk mijn reactie"
 */
export function headerActionButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(".pageheader__actions button");
}

export const isAppliedLabel = (label: string): boolean => /bekijk mijn reactie/i.test(label);
export const isReactLabel = (label: string): boolean => /reageer op deze/i.test(label);

export function buttonLabel(button: HTMLButtonElement | null): string {
  return (button?.textContent ?? "").trim();
}
