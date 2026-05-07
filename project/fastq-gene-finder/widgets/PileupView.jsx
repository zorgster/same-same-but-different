import * as Styles from "../styles/fastq-gene-finder-styles.jsx";

const NUCLEOTIDE_COLORS = {
  A: "#2ca02c",
  C: "#1f77b4",
  G: "#ff7f0e",
  T: "#d62728",
  U: "#d62728",
};

function renderColoredSequence(sequence, monoFont) {
  return Array.from(sequence || "").map((char, index) => {
    const color = NUCLEOTIDE_COLORS[char.toUpperCase()] || "#111";
    return (
      <span key={index} style={{ color, fontFamily: monoFont }}>
        {char}
      </span>
    );
  });
}

function renderCoordinateRuler(windowStart, windowLength, monoFont) {
  const chars = Array(windowLength).fill(" ");

  for (let offset = 0; offset < windowLength; offset += 10) {
    const label = String(windowStart + offset);
    for (let i = 0; i < label.length && offset + i < windowLength; i++) {
      chars[offset + i] = label[i];
    }
  }

  return <span style={{ fontFamily: monoFont }}>{chars.join("")}</span>;
}

/* ============================================================
   COMPONENT: PileupView
   Full-gene pileup visualization for matching reads
============================================================ */
export default function PileupView({
  geneSequence,
  matchingReads,
  readLength,
  windowStart = 0,
  windowSize = 150,
}) {
  if (!geneSequence) return null;
  const monoFont = '"Courier New", Courier, monospace';

  const normalizedMatches = matchingReads
    .map((m) => {
      const start = m.position ?? m.positions?.[0];
      const seq = m.read || "";
      return {
        ...m,
        start,
        end: Number.isFinite(start) ? start + Math.max(1, seq.length) : NaN,
        seq,
      };
    })
    .filter((m) => Number.isFinite(m.start))
    .sort((a, b) => a.start - b.start);

  if (!normalizedMatches.length) {
    return (
      <div
        style={{
          border: "1px solid #ccc",
          marginTop: "0.5rem",
          padding: "0.5rem",
          fontFamily: monoFont,
        }}
      >
        No matching reads to display yet.
      </div>
    );
  }

  const maxStart = Math.max(0, geneSequence.length - windowSize);
  const safeWindowStart = Math.max(0, Math.min(maxStart, windowStart));
  const windowEnd = Math.min(geneSequence.length, safeWindowStart + windowSize);

  const windowGene = geneSequence.slice(safeWindowStart, windowEnd);
  const regionLen = Math.max(1, windowGene.length);

  const visibleMatches = normalizedMatches.filter(
    (m) => m.start < windowEnd && m.end > safeWindowStart,
  );

  const rows = [];
  for (const m of visibleMatches) {
    const offset = Math.max(0, m.start - safeWindowStart);
    const clipStart = Math.max(0, safeWindowStart - m.start);
    const clipEnd = Math.min(m.seq.length, windowEnd - m.start);
    const clippedSeq = m.seq.slice(clipStart, clipEnd);

    if (!clippedSeq.length) continue;

    let placed = false;

    for (const row of rows) {
      let conflict = false;
      for (let i = 0; i < clippedSeq.length && offset + i < regionLen; i++) {
        if (row[offset + i] !== " ") {
          conflict = true;
          break;
        }
      }
      if (!conflict) {
        for (let i = 0; i < clippedSeq.length && offset + i < regionLen; i++) {
          row[offset + i] = clippedSeq[i];
        }
        placed = true;
        break;
      }
    }

    if (!placed) {
      const newRow = Array(regionLen).fill(" ");
      for (let i = 0; i < clippedSeq.length && offset + i < regionLen; i++) {
        newRow[offset + i] = clippedSeq[i];
      }
      rows.push(newRow);
    }
  }

  const underline =
    windowGene && windowGene.length ? "-".repeat(windowGene.length) : "";

  return (
    <div style={{ ...Styles.pileupContainer, overflowX: "hidden" }}>
      <div style={Styles.pileupWrapper}>
        <pre style={Styles.pileupRefPre}>
          {renderColoredSequence(windowGene, monoFont)}
        </pre>
        <pre style={Styles.pileupRulerPre}>
          {renderCoordinateRuler(safeWindowStart, regionLen, monoFont)}
        </pre>
        <pre style={Styles.pileupUnderlinePre}>{underline}</pre>

        <div
          style={{
            margin: "0.25rem 0",
            fontFamily: monoFont,
            fontSize: "10px",
          }}
        >
          window: {safeWindowStart} - {windowEnd} | showing{" "}
          {visibleMatches.length} reads
        </div>

        {rows.map((row, i) => (
          <pre key={i} style={Styles.pileupRowPre}>
            {renderColoredSequence(row.join(""), monoFont)}
          </pre>
        ))}
      </div>
    </div>
  );
}
