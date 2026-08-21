/**
 * Global hub state: one pill + tabbed drawer on every page (see Hub.tsx).
 * Open/closed and the selected tab are PERSISTED in storage, so they survive
 * page changes and reloads — no per-page auto-opening.
 */

import { signal } from "@preact/signals";
import { load, mutate } from "../data/storage";

export type HubTab = "apply" | "settings" | "reactions";

const initial = load().hub;
export const hubOpen = signal(initial.open);
export const hubTab = signal<HubTab>(
  initial.tab === "settings" || initial.tab === "reactions" ? initial.tab : "apply",
);

function persistHub(): void {
  mutate((s) => {
    s.hub = { open: hubOpen.value, tab: hubTab.value };
  });
}

export function openHubTab(tab: HubTab): void {
  hubTab.value = tab;
  hubOpen.value = true;
  persistHub();
}

export function closeHub(): void {
  hubOpen.value = false;
  persistHub();
}

export function toggleHub(): void {
  hubOpen.value = !hubOpen.value;
  persistHub();
}

export const HUB_TABS: ReadonlyArray<{ id: HubTab; label: string }> = [
  { id: "apply", label: "Apply" },
  { id: "settings", label: "Settings" },
  { id: "reactions", label: "Reactions" },
];
