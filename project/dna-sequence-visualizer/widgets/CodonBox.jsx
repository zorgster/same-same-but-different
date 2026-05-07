import * as lookup from "../sequence-lookups";

const aaColors = (aa) => {
  if (aa === "*") return { bg: "#2d0808", fg: "#ff6b6b", bd: "#6b1515" };
  if (lookup.HYDRO.has(aa))
    return { bg: "#2a1c08", fg: "#f59e0b", bd: "#6b480e" };
  if (lookup.POLAR.has(aa))
    return { bg: "#0a271a", fg: "#34d399", bd: "#0f5132" };
  if (lookup.POS.has(aa))
    return { bg: "#0a1830", fg: "#60a5fa", bd: "#1e3a8a" };
  if (lookup.NEG.has(aa))
    return { bg: "#2a0a12", fg: "#f87171", bd: "#6b1a25" };
  if (lookup.SPL.has(aa))
    return { bg: "#180a2a", fg: "#a78bfa", bd: "#4c1d95" };
  return { bg: "#111", fg: "#9ca3af", bd: "#374151" };
};

export default function CodonBox({ codon, index, rfOffset, CW }) {
  const aa = lookup.CODON_TABLE[codon] ?? "?";
  const col = aaColors(aa);
  return (
    <div
      title={`${codon} → ${lookup.AA3[aa] ?? aa}  ·  RF+${rfOffset}  ·  pos ${index + 1}–${index + 3}`}
      style={{
        width: CW * 3 - 2,
        height: 22,
        flexShrink: 0,
        margin: "2px 1px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 13,
        fontWeight: 600,
        backgroundColor: col.bg,
        color: col.fg,
        borderTop: `2px solid ${col.bd}`,
        borderBottom: `2px solid ${col.bd}`,
        borderRadius: 0,
        cursor: "default",
      }}
    >
      {aa}
    </div>
  );
}
