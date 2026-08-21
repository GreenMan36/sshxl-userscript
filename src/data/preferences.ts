/**
 * Profile sync + preference matching against listing requirements.
 *
 * Profile data (gender, birth year, signup date) is scraped when the user
 * visits mijn-profiel and stored; the panel also allows manual override.
 * Requirement matching uses room-page details (genderPreference etc.) to
 * warn before applying.
 */

import { load, mutate } from "./storage";
import type { ListingRecord } from "./listings";
import { scrapeProfileWhenReady } from "./scrapers";

/** Scrape + store profile fields. Waits out React hydration. */
export async function syncProfileFromPage(timeoutMs = 15_000): Promise<boolean> {
  const prefs = await scrapeProfileWhenReady(timeoutMs);
  const hasAny = Object.keys(prefs).length > 0;
  if (hasAny) {
    mutate((state) => {
      state.preferences = { ...state.preferences, ...prefs };
    });
  }
  return hasAny;
}

export interface RequirementIssue {
  field: string;
  message: string;
}

/**
 * Check a listing's requirements against stored preferences. Returns issues;
 * empty array = no known conflicts. Only checks what we actually know about
 * both sides — missing info on either side is not an issue.
 */
export function checkRequirements(listing: ListingRecord): RequirementIssue[] {
  const issues: RequirementIssue[] = [];
  const prefs = load().preferences;

  if (
    listing.genderPreference &&
    !/geen voorkeur/i.test(listing.genderPreference) &&
    prefs.gender &&
    !/geen voorkeur/i.test(prefs.gender)
  ) {
    // SSH gender preferences are typically "Man", "Vrouw" or "Geen voorkeur"
    if (!listing.genderPreference.toLowerCase().includes(prefs.gender.toLowerCase())) {
      issues.push({
        field: "gender",
        message: `Listing wants ${listing.genderPreference}, you are ${prefs.gender}`,
      });
    }
  }

  if (
    listing.surface !== undefined &&
    prefs.minSurface !== undefined &&
    listing.surface < prefs.minSurface
  ) {
    issues.push({
      field: "surface",
      message: `${listing.surface} m² is below your minimum ${prefs.minSurface} m²`,
    });
  }

  return issues;
}
