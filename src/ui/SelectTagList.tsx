/**
 * Tag list backed by a real dropdown: pick from the KNOWN options (the site's
 * own filter dropdowns), selected tags shown with × to remove. Used where the
 * option set is certain — cities, dwelling types, contract types, allocation.
 * Streets use the searchable TagList instead (their options are accumulated).
 */

import type { JSX } from "preact";
import { mutedStyle, selectStyle, tagRemoveButton, tagStyle } from "./styles";

export function SelectTagList(props: {
  items: string[];
  options: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  placeholder: string;
}): JSX.Element {
  const available = props.options
    .filter((option) => !props.items.some((item) => item.toLowerCase() === option.toLowerCase()))
    .sort();

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "4px" }}>
        {props.items.length === 0 ? (
          <span style={mutedStyle}>none</span>
        ) : (
          props.items.map((item) => (
            <span key={item} style={tagStyle}>
              {item}
              <button
                style={tagRemoveButton}
                onClick={() => props.onRemove(item)}
                aria-label={`Remove ${item}`}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <select
        style={selectStyle}
        value=""
        onChange={(e) => {
          const value = (e.target as HTMLSelectElement).value;
          if (value) props.onAdd(value);
        }}
      >
        <option value="">{props.placeholder}</option>
        {available.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
