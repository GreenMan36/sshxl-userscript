/**
 * Global hub: a status pill on every page (bottom-right) that opens a tabbed
 * drawer — Apply, Settings, Reactions. Mounted once at startup; routes only
 * auto-select a tab (see main.tsx). Hotkey: Alt+Shift+S.
 */

import { useEffect } from "preact/hooks";
import type { JSX } from "preact";
import { progress } from "../core/progress";
import { storeSignal } from "./store";
import { HUB_TABS, closeHub, hubOpen, hubTab, openHubTab, toggleHub } from "./hubState";
import type { HubTab } from "./hubState";
import { ApplyTab } from "./ApplyTab";
import { SettingsTab } from "./SettingsTab";
import { ReactionsTab } from "./ReactionsTab";
import {
  drawerBodyStyle,
  drawerCloseButton,
  drawerHeaderStyle,
  drawerStyle,
  pillProgressFill,
  pillProgressTrack,
  pillStyle,
  pillStyleActive,
  tabButtonActiveStyle,
  tabButtonStyle,
  tabRowStyle,
} from "./styles";

function TabBody(props: { tab: HubTab }): JSX.Element {
  switch (props.tab) {
    case "apply":
      return <ApplyTab />;
    case "settings":
      return <SettingsTab />;
    case "reactions":
      return <ReactionsTab />;
  }
}

export function Hub(): JSX.Element {
  const open = hubOpen.value;
  const tab = hubTab.value;
  const state = storeSignal.value;
  const prog = progress.value;

  const used = Object.keys(state.activeReactions).length;
  const runActive = prog.active;
  const percent = prog.total > 0 ? Math.round((prog.index / prog.total) * 100) : 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey && event.shiftKey && (event.key === "S" || event.key === "s")) {
        event.preventDefault();
        toggleHub();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div id="sshxl-aa-hub">
      <button
        id="sshxl-aa-pill"
        style={runActive ? pillStyleActive : pillStyle}
        onClick={toggleHub}
        title="SSH XL auto-apply — Alt+Shift+S"
      >
        <span>
          {used}/{state.quota} slots{runActive ? ` · ${prog.index}/${prog.total}` : ""}
        </span>
        {runActive ? (
          <span style={pillProgressTrack}>
            <span
              style={{
                ...pillProgressFill,
                width: `${percent}%`,
                display: "block",
              }}
            />
          </span>
        ) : null}
      </button>

      {open ? (
        <div id="sshxl-aa-drawer" style={drawerStyle}>
          <div style={drawerHeaderStyle}>
            <strong>SSH XL auto-apply</strong>
            <button style={drawerCloseButton} onClick={closeHub} aria-label="Close">
              ×
            </button>
          </div>
          <nav style={tabRowStyle}>
            {HUB_TABS.map((t) => (
              <button
                key={t.id}
                style={tab === t.id ? tabButtonActiveStyle : tabButtonStyle}
                onClick={() => openHubTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div style={drawerBodyStyle}>
            <TabBody tab={tab} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
