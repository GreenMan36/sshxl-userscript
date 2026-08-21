/**
 * Settings tab: friendly profile summary (raw scraped data collapsed), city
 * + bounds matching, street whitelist/blacklist, and the debug reset.
 */

import type { JSX } from "preact";
import { storeSignal, refreshStore } from "./store";
import { wipeAll } from "../data/storage";
import { log } from "../core/logger";
import { PreferencesEditor } from "./PreferencesEditor";
import { StreetListsEditor } from "./StreetListsEditor";
import { FilterFunnel } from "./FilterFunnel";
import { rowStyle, mutedStyle, sectionTitle, dangerButton } from "./styles";

export function SettingsTab(): JSX.Element {
  const state = storeSignal.value;
  const prefs = state.preferences;
  const entries: Array<[string, string | undefined]> = [
    ["Gender", prefs.gender],
    ["Birth year", prefs.birthYear !== undefined ? String(prefs.birthYear) : undefined],
    ["Signed up", prefs.signUpDate],
    ["Preferred city", prefs.preferredCity],
    ["Education", prefs.education],
    [
      "Studies start",
      prefs.studiesStartYear !== undefined ? String(prefs.studiesStartYear) : undefined,
    ],
  ];
  const profileLine =
    prefs.gender !== undefined || prefs.birthYear !== undefined || prefs.signUpDate !== undefined
      ? [
          prefs.gender,
          prefs.birthYear !== undefined ? `born ${prefs.birthYear}` : undefined,
          prefs.signUpDate !== undefined ? `registered ${prefs.signUpDate}` : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(" · ")
      : "Not synced yet — visit mijn-profiel.";

  const onReset = (): void => {
    if (
      !window.confirm("Reset all SSH XL auto-apply state to a blank slate? This cannot be undone.")
    ) {
      return;
    }
    log.warn("wipe: resetting all stored state to a blank slate");
    wipeAll();
    refreshStore();
    location.reload();
  };

  return (
    <div>
      <div style={sectionTitle}>Profile</div>
      <div>{profileLine}</div>
      <details>
        <summary style={{ ...mutedStyle, cursor: "pointer", marginTop: "4px" }}>
          Raw scraped profile
        </summary>
        {entries.map(([key, value]) => (
          <div key={key} style={rowStyle}>
            <strong>{key}:</strong> {value ?? <em style={mutedStyle}>unknown</em>}
          </div>
        ))}
      </details>

      <div style={sectionTitle}>Matching</div>
      <FilterFunnel />
      <PreferencesEditor />
      <StreetListsEditor />

      <div style={sectionTitle}>Debug</div>
      <button style={dangerButton} onClick={onReset}>
        Reset to blank slate
      </button>
      <div style={{ ...mutedStyle, marginTop: "6px", fontSize: "11px" }}>
        Wipes all tracked listings, preferences, filters and reactions.
      </div>
    </div>
  );
}
