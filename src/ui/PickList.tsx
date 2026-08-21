/** The ranked pick list with retry/refused annotations. */

import type { JSX } from "preact";
import type { ListingRecord } from "../data/listings";
import { hoursLeft } from "../data/listings";
import { rowStyle, mutedStyle } from "./styles";

export function PickList(props: { picks: ListingRecord[] }): JSX.Element {
  if (props.picks.length === 0) {
    return <div style={mutedStyle}>Nothing selected — check filters or slot availability.</div>;
  }
  return (
    <div>
      {props.picks.map((listing, index) => {
        const refused = listing.status === "not-eligible" ? " (refused)" : "";
        const applied = listing.status === "applied" ? " (applied)" : "";
        const left = hoursLeft(listing);
        const label = left !== undefined ? `${Math.ceil(left)}h left` : "deadline unknown";
        return (
          <div key={listing.id} style={rowStyle}>
            {index + 1}. {listing.title} — {label}
            {refused}
            {applied}
          </div>
        );
      })}
    </div>
  );
}
