/**
 * Street filter: ONE list with a persisted whitelist/blacklist MODE toggle.
 *   Whitelist mode — only these streets are picked (exclusive).
 *   Blacklist mode — these streets are never picked.
 * Only the active mode's list applies (planner-side); the other list is
 * preserved but ignored. The mode is stored, so it survives navigation.
 */

import type { JSX } from "preact";
import { mutate } from "../data/storage";
import { storeSignal, refreshStore } from "./store";
import { TagList } from "./TagList";
import { mutedStyle, sectionTitle, toggleButton, toggleButtonActive } from "./styles";

type Mode = "whitelist" | "blacklist";

export function StreetListsEditor(): JSX.Element {
  const state = storeSignal.value;
  const mode = state.filters.streetMode;
  const list = mode === "whitelist" ? state.filters.whitelist : state.filters.blacklist;
  const hint =
    mode === "whitelist"
      ? "Only these streets are picked. Leave empty to pick anywhere."
      : "These streets are never picked.";

  const setMode = (next: Mode): void => {
    if (next === mode) return;
    mutate((s) => {
      s.filters.streetMode = next;
    });
    refreshStore();
  };

  const add = (value: string): void => {
    mutate((s) => {
      if (!s.filters[mode].some((entry) => entry.toLowerCase() === value.toLowerCase()))
        s.filters[mode].push(value);
    });
    refreshStore();
  };

  const remove = (value: string): void => {
    mutate((s) => {
      s.filters[mode] = s.filters[mode].filter((entry) => entry !== value);
    });
    refreshStore();
  };

  return (
    <div>
      <div style={sectionTitle}>Streets</div>
      <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
        <button
          style={mode === "whitelist" ? toggleButtonActive : toggleButton}
          onClick={() => setMode("whitelist")}
        >
          Whitelist (only these)
        </button>
        <button
          style={mode === "blacklist" ? toggleButtonActive : toggleButton}
          onClick={() => setMode("blacklist")}
        >
          Blacklist (never these)
        </button>
      </div>
      <TagList
        items={list}
        options={state.knownStreets}
        onAdd={add}
        onRemove={remove}
        placeholder="Add street… (type to search)"
        listId="sshxl-known-streets"
      />
      <div style={{ ...mutedStyle, marginTop: "4px", fontSize: "11px" }}>{hint}</div>
    </div>
  );
}
