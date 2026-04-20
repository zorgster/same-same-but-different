import { COLORS } from "../styles/vcf-header-reader-styles.jsx";

export default function ProducerChips({ producers }) {
  const items = Array.isArray(producers) ? producers.filter(Boolean) : [];
  if (!items.length) {
    return <span style={{ color: COLORS.muted, fontSize: 11 }}>-</span>;
  }

  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
      {items.map((producer) => (
        <span
          key={producer}
          style={{
            display: "inline-block",
            borderRadius: 999,
            border: `1px solid ${COLORS.border}`,
            background: "#f3f7ff",
            color: "#1f4f99",
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1.3,
            whiteSpace: "nowrap",
          }}
        >
          {producer}
        </span>
      ))}
    </span>
  );
}