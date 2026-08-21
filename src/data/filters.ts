/**
 * Autofill the aanbod page's filter dropdowns from stored preferences.
 *
 * The filter is client-side (React listens to change events on the selects),
 * so we set values programmatically and dispatch bubbling `change` events —
 * the same signal a user's interaction produces. Select ids from the live
 * markup: a11y-af1-city, a11y-af2-price, a11y-af3-type, a11y-af4-contracttype,
 * a11y-af5-allocation.
 */

import { load } from "./storage";

const SELECT_IDS = {
  city: "a11y-af1-city",
  price: "a11y-af2-price",
  type: "a11y-af3-type",
  contract: "a11y-af4-contracttype",
  allocation: "a11y-af5-allocation",
} as const;

function setSelectValue(id: string, value: string): boolean {
  const select = document.querySelector<HTMLSelectElement>(`#${id}`);
  if (!select) return false;
  // Only select a value that actually exists as an option.
  const has = Array.from(select.options).some((option) => option.value === value);
  if (!has || select.value === value) return false;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export interface AutofillResult {
  city: boolean;
  allocation: boolean;
}

/** All options of a site filter select (skips the empty placeholder). */
function collectSelectOptions(selectId: string): string[] {
  const select = document.querySelector<HTMLSelectElement>(`#${selectId}`);
  if (!select) return [];
  return Array.from(select.options)
    .map((option) => option.value.trim())
    .filter((value) => value.length > 0);
}

/** All cities the site offers, from the overview's city filter dropdown. */
export function collectCityOptions(): string[] {
  return collectSelectOptions(SELECT_IDS.city);
}

/** Dwelling types the site offers ("kamer", "woning"). */
export function collectDwellingTypes(): string[] {
  return collectSelectOptions(SELECT_IDS.type);
}

/** Contract types the site offers ("Campuscontract", …). */
export function collectContractTypes(): string[] {
  return collectSelectOptions(SELECT_IDS.contract);
}

/**
 * Apply preference-derived filter selections. Cities use the first preferred
 * city (the site's select is single-value). Returns which selects changed.
 */
export function autofillFilters(): AutofillResult {
  const prefs = load().preferences;
  const city = prefs.cities?.[0] ?? prefs.preferredCity ?? "";
  return {
    city: city ? setSelectValue(SELECT_IDS.city, city) : false,
    allocation: prefs.allocation?.length
      ? setSelectValue(SELECT_IDS.allocation, prefs.allocation[0] ?? "")
      : false,
    // price bucket intentionally not auto-filled: it is a coarse filter that
    // can hide listings whose exact rent the user would accept; available via
    // manual use. Kept in one place so the policy is easy to change.
  };
}
