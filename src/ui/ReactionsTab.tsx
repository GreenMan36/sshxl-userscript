/** Reactions tab: open reactions with positions + mass-unreact selection.
 * Reads the durable slot state (activeReactions + listing records) so it
 * works from any page; slots are reconciled on reacties-page visits. */

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { storeSignal } from "./store";
import { progress } from "../core/progress";
import { startUnreactRun } from "../core/unreact";
import { log } from "../core/logger";
import type { ListingRecord } from "../data/listings";
import { rowStyle, dangerButton, mutedStyle, sectionTitle } from "./styles";

export function ReactionsTab(): JSX.Element {
  const state = storeSignal.value;
  const prog = progress.value;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const ids = Object.keys(state.activeReactions);

  if (prog.active) {
    return (
      <div>
        <div style={{ fontWeight: "700", marginBottom: "6px" }}>Unreact run in progress…</div>
        <div style={mutedStyle}>See the Apply tab / progress pill.</div>
      </div>
    );
  }

  const toggle = (id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onUnreact = (): void => {
    const idsToWithdraw = [...selected];
    if (idsToWithdraw.length === 0) return;
    log.warn(`starting mass-unreact of ${idsToWithdraw.length} reaction(s)`, idsToWithdraw);
    startUnreactRun(idsToWithdraw);
  };

  return (
    <div>
      <div style={sectionTitle}>Open reactions</div>
      {ids.length === 0 ? (
        <div style={mutedStyle}>No open reactions. Visit the reacties page to sync.</div>
      ) : (
        <div>
          {ids.map((id) => {
            const listing = state.db.listings[id] as ListingRecord | undefined;
            const label = listing?.title ?? `Reaction ${id}`;
            const pos = listing?.slotPosition;
            const total = listing?.slotTotal;
            const confirmed = state.activeReactions[id]?.lastConfirmedTs;
            return (
              <label
                key={id}
                style={{ ...rowStyle, display: "flex", gap: "6px", alignItems: "center" }}
              >
                <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
                <span style={{ flex: 1 }}>
                  {label}
                  {pos !== undefined && total !== undefined ? ` — plek ${pos} van ${total}` : ""}
                </span>
                {confirmed ? (
                  <span
                    style={{ ...mutedStyle, marginLeft: "6px", fontSize: "11px" }}
                    title="Last confirmed on the reacties page"
                  >
                    {new Date(confirmed).toLocaleDateString()}
                  </span>
                ) : null}
                <a href={`/nl/mijn-ssh/reacties/${id}`} style={{ color: "#146be2" }}>
                  open
                </a>
              </label>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button style={dangerButton} disabled={selected.size === 0} onClick={onUnreact}>
          Withdraw selected ({selected.size})
        </button>
      </div>
      <div style={{ ...mutedStyle, marginTop: "6px", fontSize: "11px" }}>
        Withdrawing opens each reaction page one by one in this tab. Slot state syncs on the
        reacties page.
      </div>
    </div>
  );
}
