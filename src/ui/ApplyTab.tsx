/**
 * Apply tab: slot status, current-room status, run progress + stop, and the
 * ranked pick list with Fill. The single actionable surface — Dashboard was
 * folded into here (slot count duplicated the pill; the quota editor was
 * removed since the allowance is fixed at the site limit).
 */

import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { buildSlotPlan, syncCardsIntoDb } from "../data/planner";
import { load, mutate } from "../data/storage";
import { activeCount } from "../data/reactions";
import { storeSignal, refreshStore } from "./store";
import { progress } from "../core/progress";
import { listingId } from "../data/page";
import type { ListingRecord } from "../data/listings";
import { log } from "../core/logger";
import { startRun } from "./runControl";
import { PickList } from "./PickList";
import { primaryButton, secondaryButton, mutedStyle, rowStyle } from "./styles";

export function ApplyTab(): JSX.Element {
  const state = storeSignal.value;
  const prog = progress.value;
  const [notice, setNotice] = useState("");

  const used = Object.keys(state.activeReactions).length;
  const free = Math.max(0, state.quota - used);
  const percent = prog.total > 0 ? Math.round((prog.index / prog.total) * 100) : 0;
  const plan = buildSlotPlan(state.quota, activeCount());

  // On a room page, show the current listing's application state: applied?
  // position/total (same fields the reacties page writes), deadline.
  const roomId = listingId();
  const currentRoom = roomId ? (state.db.listings[roomId] as ListingRecord | undefined) : undefined;

  const onStart = (): void => {
    setNotice("");
    const mergedCount = syncCardsIntoDb().length;
    const freshPlan = buildSlotPlan(load().quota, activeCount());
    log.info(
      `start requested: ${mergedCount} cards synced, ${freshPlan.activeCount}/${freshPlan.slotLimit} slots used, ${freshPlan.freeSlots} free, ${freshPlan.picks.length} eligible`,
    );
    if (freshPlan.picks.length === 0) {
      const reason =
        freshPlan.freeSlots === 0
          ? `no free slots (${freshPlan.activeCount}/${freshPlan.slotLimit} active)`
          : "every tracked listing is applied/refused or filtered out";
      log.warn("nothing to fill:", reason);
      setNotice(`Nothing to fill: ${reason}.`);
      return;
    }
    startRun(
      freshPlan.picks.map((listing) => ({
        id: listing.id,
        url: listing.url,
        title: listing.title,
      })),
    );
  };

  const onStop = (): void => {
    log.warn("run stopped by user");
    mutate((s) => {
      s.run = null;
    });
    refreshStore();
  };

  return (
    <div>
      {currentRoom ? (
        <div style={rowStyle}>
          <strong>Current room:</strong>{" "}
          {currentRoom.status === "applied" ? "Applied" : currentRoom.status}
          {currentRoom.slotPosition !== undefined
            ? ` · #${currentRoom.slotPosition}${currentRoom.slotTotal !== undefined ? `/${currentRoom.slotTotal}` : ""}`
            : ""}
          {currentRoom.endsAtTs !== undefined
            ? ` · ends ${new Date(currentRoom.endsAtTs).toLocaleString()}`
            : ""}
        </div>
      ) : null}

      <div style={{ marginBottom: "4px", color: "#555" }}>
        {used} used · {free} free
      </div>

      {prog.active ? (
        <div style={rowStyle}>
          <div>
            {prog.index}/{prog.total} — {prog.roomTitle}
          </div>
          <div style={mutedStyle}>{prog.step}</div>
          <div
            style={{
              marginTop: "6px",
              height: "4px",
              background: "#eee",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "4px",
                width: `${percent}%`,
                background: "#146be2",
                borderRadius: "2px",
                transition: "width .3s ease",
              }}
            />
          </div>
          <div style={{ marginTop: "8px" }}>
            <button style={secondaryButton} onClick={onStop}>
              Stop
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button style={primaryButton} disabled={Boolean(state.run)} onClick={onStart}>
          Fill {free} free slot{free === 1 ? "" : "s"}
        </button>
      </div>
      {notice ? <div style={{ marginBottom: "6px", color: "#b00020" }}>{notice}</div> : null}
      <PickList picks={plan.picks} />
      <div style={{ ...mutedStyle, marginTop: "8px", fontSize: "11px" }}>
        Rooms are applied one by one in this tab. Keep it open while a run is active.
      </div>
    </div>
  );
}
