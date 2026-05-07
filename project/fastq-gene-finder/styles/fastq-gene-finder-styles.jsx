// Shared style constants for FastqGeneFinder UI
export const container = {
  padding: "1rem",
  fontFamily: "monospace",
};

export const panel = {
  border: "2px solid #444",
  padding: "1rem",
};

export const fileDropZone = {
  border: "2px solid #444",
  padding: "1rem",
  background: "#f7f7fb",
};

export const seedPanel = {
  marginTop: "1rem",
  border: "2px solid #444",
  padding: "1rem",
  backgroundColor: "#f5f5f5",
  maxHeight: "400px",
  overflowY: "auto",
  overflowX: "visible",
};

export const monoFont = '\"Courier New\", Courier, monospace';

export const twoColumn = {
  display: "flex",
  gap: "1rem",
  marginTop: "1rem",
};

export const leftColumn = { flex: 1 };

export const rightColumn = { minWidth: "450px", overflowX: "visible" };

export const smallMargin = { marginTop: "0.5rem" };

export const matchList = {
  maxHeight: 200,
  overflow: "auto",
  fontFamily: monoFont,
};

export const pileupContainer = {
  border: "1px solid #ccc",
  marginTop: "0.5rem",
  overflowX: "hidden",
};

export const pileupWrapper = {
  fontFamily: monoFont,
  whiteSpace: "pre",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.15,
  fontSize: "11px",
};

export const pileupRefPre = {
  margin: 0,
  background: "#eef",
  padding: "2px",
  fontFamily: monoFont,
};

export const pileupRulerPre = {
  margin: 0,
  padding: "2px",
  fontFamily: monoFont,
  background: "#f8f8f8",
};

export const pileupUnderlinePre = {
  margin: 0,
  padding: "2px",
  fontFamily: monoFont,
  background: "#ddd",
};

export const pileupRowPre = {
  margin: 0,
  padding: "2px",
  fontFamily: monoFont,
  fontSize: "11px",
};

export const Pileup = {
  Container: pileupContainer,
  Wrapper: pileupWrapper,
  RefPre: pileupRefPre,
  RulerPre: pileupRulerPre,
  UnderlinePre: pileupUnderlinePre,
  RowPre: pileupRowPre,
};

export default {
  container,
  panel,
  fileDropZone,
  seedPanel,
  monoFont,
  pileupContainer,
  pileupWrapper,
  pileupRefPre,
  pileupRulerPre,
  pileupUnderlinePre,
  pileupRowPre,
  Pileup,
};

export const modalOverlay = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "rgba(10, 12, 18, 0.72)",
  backdropFilter: "blur(4px)",
  zIndex: 1000,
  padding: "1rem",
};

export const modalCard = {
  position: "relative",
  width: "min(900px, 100%)",
  maxHeight: "80vh",
  overflowY: "auto",
  backgroundColor: "#fffdf7",
  color: "#1f1f1f",
  border: "2px solid #222",
  borderRadius: "14px",
  boxShadow: "0 18px 60px rgba(0, 0, 0, 0.35)",
  padding: "1.25rem 1.25rem 1rem",
  fontFamily: monoFont,
  lineHeight: 1.5,
};

export const modalCloseButton = {
  position: "absolute",
  top: "0.5rem",
  right: "0.5rem",
  width: "2rem",
  height: "2rem",
  border: "1px solid #444",
  borderRadius: "999px",
  backgroundColor: "#f3f3f3",
  color: "#111",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "1.1rem",
  lineHeight: 1,
};
