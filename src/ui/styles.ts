/** Shared inline-style objects for the injected UI. */

const base: Record<string, string> = {
  font: "13px/1.45 system-ui,sans-serif",
  zIndex: "2147483647",
};

export const panelStyle: Record<string, string> = {
  ...base,
  position: "fixed",
  bottom: "20px",
  right: "20px",
  width: "330px",
  maxHeight: "70vh",
  overflowY: "auto",
  background: "#fff",
  color: "#222",
  border: "1px solid #ddd",
  borderRadius: "10px",
  boxShadow: "0 6px 24px rgba(0,0,0,.25)",
  padding: "14px",
};

export const hudStyle: Record<string, string> = {
  ...base,
  position: "fixed",
  top: "16px",
  right: "16px",
  background: "#146be2",
  color: "#fff",
  borderRadius: "10px",
  boxShadow: "0 6px 24px rgba(0,0,0,.3)",
  padding: "10px 14px",
  minWidth: "220px",
};

export const primaryButton: Record<string, string> = {
  flex: "1",
  padding: "8px",
  border: "0",
  borderRadius: "6px",
  background: "#146be2",
  color: "#fff",
  fontWeight: "700",
  cursor: "pointer",
};

export const secondaryButton: Record<string, string> = {
  padding: "8px 12px",
  border: "1px solid #ccc",
  borderRadius: "6px",
  background: "#fff",
  cursor: "pointer",
};

export const dangerButton: Record<string, string> = {
  ...secondaryButton,
  borderColor: "#d9534f",
  color: "#d9534f",
};

export const rowStyle: Record<string, string> = {
  padding: "4px 0",
  borderTop: "1px solid #eee",
};

export const mutedStyle: Record<string, string> = { color: "#888" };

export const sectionTitle: Record<string, string> = {
  fontWeight: "700",
  margin: "10px 0 4px",
};

export const inputStyle: Record<string, string> = {
  width: "150px",
  padding: "3px 6px",
  border: "1px solid #ccc",
  borderRadius: "4px",
};

// ------------------------------------------------------------- global hub

export const pillStyle: Record<string, string> = {
  ...base,
  position: "fixed",
  bottom: "16px",
  right: "16px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "4px",
  padding: "8px 16px",
  border: "0",
  borderRadius: "999px",
  background: "#146be2",
  color: "#fff",
  fontWeight: "700",
  fontSize: "12px",
  lineHeight: "1.3",
  cursor: "pointer",
  boxShadow: "0 4px 16px rgba(0,0,0,.3)",
};

/** Pill accent while a run is active. */
export const pillStyleActive: Record<string, string> = {
  ...pillStyle,
  background: "#0f4fae",
};

export const pillProgressTrack: Record<string, string> = {
  width: "100px",
  height: "4px",
  background: "rgba(255,255,255,.35)",
  borderRadius: "2px",
  overflow: "hidden",
};

export const pillProgressFill: Record<string, string> = {
  height: "4px",
  background: "#fff",
  borderRadius: "2px",
  transition: "width .3s ease",
};

export const drawerStyle: Record<string, string> = {
  ...base,
  position: "fixed",
  bottom: "16px",
  right: "16px",
  width: "360px",
  maxHeight: "72vh",
  display: "flex",
  flexDirection: "column",
  background: "#fff",
  color: "#222",
  border: "1px solid #ddd",
  borderRadius: "12px",
  boxShadow: "0 8px 32px rgba(0,0,0,.28)",
  overflow: "hidden",
};

export const drawerHeaderStyle: Record<string, string> = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 14px",
  borderBottom: "1px solid #eee",
};

export const drawerCloseButton: Record<string, string> = {
  border: "0",
  background: "none",
  fontSize: "18px",
  lineHeight: "1",
  cursor: "pointer",
  color: "#666",
};

export const tabRowStyle: Record<string, string> = {
  display: "flex",
  borderBottom: "1px solid #eee",
};

export const tabButtonStyle: Record<string, string> = {
  flex: "1",
  padding: "8px 0",
  border: "0",
  background: "#f7f7f7",
  cursor: "pointer",
  fontWeight: "600",
  fontSize: "12px",
};

export const tabButtonActiveStyle: Record<string, string> = {
  ...tabButtonStyle,
  background: "#fff",
  color: "#146be2",
  boxShadow: "inset 0 -2px 0 #146be2",
};

export const drawerBodyStyle: Record<string, string> = {
  padding: "12px 14px",
  overflowY: "auto",
};

// ------------------------------------------------------------- tag lists

export const tagStyle: Record<string, string> = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  padding: "2px 8px",
  borderRadius: "999px",
  background: "#eef2f7",
  border: "1px solid #d5dce5",
  fontSize: "12px",
};

export const tagRemoveButton: Record<string, string> = {
  border: "0",
  background: "none",
  cursor: "pointer",
  color: "#666",
  padding: "0",
  fontSize: "13px",
  lineHeight: "1",
};

export const tagInputStyle: Record<string, string> = {
  flex: "1",
  minWidth: "120px",
  padding: "4px 6px",
  border: "1px solid #ccc",
  borderRadius: "4px",
};

/** Box for the matching funnel summary. */
export const summaryBoxStyle: Record<string, string> = {
  background: "#f6f8fb",
  border: "1px solid #e2e8f0",
  borderRadius: "8px",
  padding: "10px 12px",
  marginBottom: "10px",
};

/** Full-width dropdown for pick-from-known-options lists. */
export const selectStyle: Record<string, string> = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid #ccc",
  borderRadius: "4px",
  background: "#fff",
};

export const smallButton: Record<string, string> = {
  padding: "4px 12px",
  border: "1px solid #ccc",
  borderRadius: "4px",
  background: "#fff",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const toggleButton: Record<string, string> = {
  flex: "1",
  padding: "6px 0",
  border: "1px solid #ccc",
  borderRadius: "6px",
  background: "#fff",
  cursor: "pointer",
  fontWeight: "600",
  fontSize: "12px",
};

export const toggleButtonActive: Record<string, string> = {
  ...toggleButton,
  background: "#146be2",
  color: "#fff",
  borderColor: "#146be2",
};
