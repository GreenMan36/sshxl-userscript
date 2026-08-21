/**
 * Matching preferences: cities, budget (max rent after huurtoeslag, min
 * surface, subsidy-only) and listing type (dwelling, contract, allocation).
 * Options known for certain come from the site's own filter dropdowns via
 * SelectTagList; everything persists IMMEDIATELY on change. The filter funnel
 * (SettingsTab) shows the combined effect — no per-field counts here.
 */

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { mutate } from "../data/storage";
import { storeSignal, refreshStore } from "./store";
import { SelectTagList } from "./SelectTagList";
import { inputStyle, sectionTitle } from "./styles";

const ALLOCATION_OPTIONS = ["hospiteren", "bezichtiging"];

export function PreferencesEditor(): JSX.Element {
  const state = storeSignal.value;
  const prefs = state.preferences;
  const [draft, setDraft] = useState(() => ({
    maxRent: prefs.maxRent !== undefined ? String(prefs.maxRent) : "",
    minSurface: prefs.minSurface !== undefined ? String(prefs.minSurface) : "",
    subsidyOnly: prefs.subsidyOnly ?? false,
  }));

  const toggle =
    (key: "cities" | "dwellingTypes" | "contractTypes") =>
    (value: string): void => {
      mutate((s) => {
        const list = s.preferences[key] ?? [];
        if (!list.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
          s.preferences[key] = [...list, value];
        } else {
          s.preferences[key] = list.filter((entry) => entry.toLowerCase() !== value.toLowerCase());
        }
      });
      refreshStore();
    };

  const toggleAllocation = (value: string): void => {
    mutate((s) => {
      const list = s.preferences.allocation ?? [];
      const next = list.some((entry) => entry.toLowerCase() === value.toLowerCase())
        ? list.filter((entry) => entry.toLowerCase() !== value.toLowerCase())
        : [...list, value as "hospiteren" | "bezichtiging"];
      s.preferences.allocation = next;
    });
    refreshStore();
  };

  const setBound = (key: "maxRent" | "minSurface", value: string): void => {
    setDraft((d) => ({ ...d, [key]: value }));
    const parsed = Number.parseFloat(value.replace(",", "."));
    mutate((s) => {
      s.preferences[key] = Number.isFinite(parsed) ? parsed : undefined;
    });
    refreshStore();
  };

  const setSubsidyOnly = (checked: boolean): void => {
    setDraft((d) => ({ ...d, subsidyOnly: checked }));
    mutate((s) => {
      s.preferences.subsidyOnly = checked;
    });
    refreshStore();
  };

  return (
    <div>
      <div style={sectionTitle}>Cities</div>
      <SelectTagList
        items={prefs.cities ?? []}
        options={state.knownCities}
        onAdd={toggle("cities")}
        onRemove={toggle("cities")}
        placeholder="Pick a city…"
      />

      <div style={sectionTitle}>Budget</div>
      <BoundInput
        label="Max rent €/mnd (after huurtoeslag)"
        value={draft.maxRent}
        onChange={(value) => setBound("maxRent", value)}
      />
      <BoundInput
        label="Min m²"
        value={draft.minSurface}
        onChange={(value) => setBound("minSurface", value)}
      />
      <label style={{ display: "flex", alignItems: "center", gap: "6px", margin: "6px 0" }}>
        <input
          type="checkbox"
          checked={draft.subsidyOnly}
          onChange={(e) => setSubsidyOnly((e.target as HTMLInputElement).checked)}
        />
        Only listings with huurtoeslag
      </label>

      <div style={sectionTitle}>Listing type</div>
      <div style={{ fontSize: "12px", margin: "6px 0 2px" }}>Dwelling types</div>
      <SelectTagList
        items={prefs.dwellingTypes ?? []}
        options={state.knownDwellingTypes}
        onAdd={toggle("dwellingTypes")}
        onRemove={toggle("dwellingTypes")}
        placeholder="Pick a type…"
      />
      <div style={{ fontSize: "12px", margin: "6px 0 2px" }}>Contract types</div>
      <SelectTagList
        items={prefs.contractTypes ?? []}
        options={state.knownContractTypes}
        onAdd={toggle("contractTypes")}
        onRemove={toggle("contractTypes")}
        placeholder="Pick a contract…"
      />
      <div style={{ fontSize: "12px", margin: "6px 0 2px" }}>Allocation</div>
      <SelectTagList
        items={prefs.allocation ?? []}
        options={ALLOCATION_OPTIONS}
        onAdd={toggleAllocation}
        onRemove={toggleAllocation}
        placeholder="Pick an allocation…"
      />
    </div>
  );
}

function BoundInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div style={{ margin: "6px 0" }}>
      <div style={{ fontSize: "12px", marginBottom: "2px" }}>{props.label}</div>
      <input
        style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
        type="number"
        value={props.value}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}
