/**
 * Matching funnel: shows how many actionable listings survive each ACTIVE
 * filter, in planner order, ending with the real eligible count. Unlike
 * isolated per-setting counts this shows exactly where listings drop — if
 * several steps show the same remaining count, the step that reduced it is
 * the one that matters.
 */

import type { JSX } from "preact";
import { filterFunnel } from "../data/planner";
import { mutedStyle, summaryBoxStyle } from "./styles";

export function FilterFunnel(): JSX.Element {
  const { total, steps, eligible } = filterFunnel();

  if (steps.length === 0) {
    return (
      <div style={summaryBoxStyle}>
        <strong>All {total} available listings match</strong>
        <div style={mutedStyle}>Add a filter below to narrow the Apply list.</div>
      </div>
    );
  }

  return (
    <div style={summaryBoxStyle}>
      <div style={{ fontWeight: "700", marginBottom: "6px" }}>
        {eligible} of {total} available match your settings
      </div>
      {steps.map((step) => (
        <div
          key={step.label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "8px",
            fontSize: "12px",
            padding: "2px 0",
          }}
        >
          <span>{step.label}</span>
          <span style={mutedStyle}>
            {step.removed + step.remaining} → {step.remaining}
            {step.removed > 0 ? ` (removed ${step.removed})` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
