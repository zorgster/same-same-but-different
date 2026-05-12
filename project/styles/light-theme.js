// Central theme for SSBD — light bioinformatics style.
// Import from here rather than defining colours inline per-tool.

// ── UI Palette ──────────────────────────────────────────────────────────────
export const COLORS = {
  bg:          "#f5f7fb",
  surface:     "#ffffff",
  border:      "#d8deea",
  borderHover: "#a8b4cc",
  text:        "#1a2332",
  muted:       "#5a6a7a",
  accent:      "#0f766e",   // teal — primary interactive colour
  accentSoft:  "#ccfbf1",
  error:       "#b91c1c",
  warning:     "#b45309",
  success:     "#15803d",
};

// ── Nucleotide Colours — light-theme (readable on white / #f5f7fb) ───────────
// Convention: A=green  T=red  C=blue  G=amber  (IGV / Chromas style)
// U is identical in role to T (both pair with A).
export const DNA_COLORS = {
  A: "#1b7a2e",   // Adenine  — deep green
  T: "#b71c1c",   // Thymine  — deep red
  C: "#1a5ea8",   // Cytosine — deep blue
  G: "#b45000",   // Guanine  — deep amber
  N: "#78909c",   // unknown  — blue-grey
};

export const RNA_COLORS = {
  A: "#1b7a2e",   // Adenine  — deep green
  U: "#b71c1c",   // Uracil   — deep red  (same family as T)
  C: "#1a5ea8",   // Cytosine — deep blue
  G: "#b45000",   // Guanine  — deep amber
  N: "#78909c",
};

// ── Typography ───────────────────────────────────────────────────────────────
export const MONO_FONT = '"Courier New", Courier, monospace';
export const UI_FONT   = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
