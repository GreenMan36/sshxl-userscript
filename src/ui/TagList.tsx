/**
 * Tag list with native `<datalist>` autocomplete: type to search the known
 * options, pick from the dropdown, then Add (button or Enter) to insert; × on
 * a tag to remove. Reads the input value directly (ref), so adding works
 * regardless of how the value got there. Used for cities, whitelist/blacklist.
 */

import { useRef } from "preact/hooks";
import type { JSX } from "preact";
import { mutedStyle, smallButton, tagInputStyle, tagRemoveButton, tagStyle } from "./styles";

export function TagList(props: {
  items: string[];
  options: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  placeholder: string;
  listId: string;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const options = [...props.options].sort();

  const add = (): void => {
    const value = (inputRef.current?.value ?? "").trim();
    if (!value) return;
    props.onAdd(value);
    if (inputRef.current) inputRef.current.value = "";
  };

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
      <div style={{ display: "flex", gap: "4px" }}>
        <input
          ref={inputRef}
          list={props.listId}
          style={tagInputStyle}
          placeholder={props.placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button style={smallButton} onClick={add}>
          Add
        </button>
      </div>
      <datalist id={props.listId}>
        {options.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
    </div>
  );
}
