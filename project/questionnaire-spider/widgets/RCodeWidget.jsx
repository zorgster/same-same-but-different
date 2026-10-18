import { useState } from "react";
import { COLORS, MONO_FONT } from "../../styles/light-theme";
import { R_CODE } from "./r-code";

const styles = {
  infoButton: { padding: "0.5rem 0.75rem", border: `1px solid ${COLORS.borderHover}`, borderRadius: 8, backgroundColor: COLORS.surface, color: COLORS.text, cursor: "pointer", fontWeight: 600 },
  overlay: { position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(10, 12, 18, 0.72)", backdropFilter: "blur(4px)", zIndex: 1000, padding: "1rem" },
  card: { position: "relative", width: "min(900px, 100%)", maxHeight: "85vh", overflowY: "auto", backgroundColor: COLORS.surface, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 14, boxShadow: "0 18px 60px rgba(0, 0, 0, 0.35)", padding: "1.25rem", lineHeight: 1.5 },
  close: { position: "absolute", top: "0.5rem", right: "0.5rem", width: "2rem", height: "2rem", border: `1px solid ${COLORS.borderHover}`, borderRadius: 999, backgroundColor: COLORS.bg, color: COLORS.text, cursor: "pointer", fontSize: "1.1rem", lineHeight: 1 },
  code: { background: COLORS.bg, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12, fontFamily: MONO_FONT, fontSize: 12.5, overflowX: "auto", whiteSpace: "pre", margin: "12px 0" },
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 },
  button: { padding: "0.4rem 0.9rem", border: `1px solid ${COLORS.accent}`, borderRadius: 7, background: "transparent", color: COLORS.accent, fontWeight: 600, cursor: "pointer" },
};

export default function RCodeWidget() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(R_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable: user can still select the text */
    }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={styles.infoButton}>R code</button>
      {open && (
        <div style={styles.overlay} onClick={() => setOpen(false)}>
          <div style={styles.card} onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setOpen(false)} style={styles.close} aria-label="Close">x</button>
            <div style={{ paddingRight: "2rem" }}>
              <strong>Draw this chart in R</strong> with the <code>fmsb</code> package (<code>radarchart()</code>).
              Install <code>fmsb</code> and <code>scales</code>, paste the script into R or RStudio, replace the sample
              data with your own table, and run it.
            </div>
            <pre style={styles.code}>{R_CODE}</pre>
            <div style={styles.footer}>
              <button type="button" style={styles.button} onClick={copy}>{copied ? "Copied" : "Copy"}</button>
              <button type="button" style={styles.button} onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
