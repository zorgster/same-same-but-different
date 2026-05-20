import * as Styles from "../styles/fastq-gene-finder-styles.jsx";

const NUCLEOTIDE_COLORS = {
  A: "#2ca02c",
  C: "#1f77b4",
  G: "#ff7f0e",
  T: "#d62728",
  U: "#d62728",
};

function renderColoredSequence(sequence, monoFont, refSequence = null) {
  return Array.from(sequence || "").map((char, index) => {
    if (char === "~") {
      return <span key={index} style={{ color: "#bbb", fontFamily: monoFont }}>~</span>;
    }
    const color = NUCLEOTIDE_COLORS[char.toUpperCase()] || "#111";
    const mismatch = refSequence && char !== " " &&
      refSequence[index] && char.toUpperCase() !== refSequence[index].toUpperCase();
    return (
      <span key={index} style={{ color, fontFamily: monoFont, backgroundColor: mismatch ? "rgba(255,200,0,0.45)" : undefined }}>
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

function renderGenomicRuler(windowStart, windowLength, geneInfo, monoFont) {
  const chars = Array(windowLength).fill(" ");
  const minus = geneInfo.strand === -1;
  const firstMark = Math.ceil(windowStart / 25) * 25;
  for (let genePos = firstMark; genePos < windowStart + windowLength; genePos += 25) {
    const offset = genePos - windowStart;
    const chrom = minus ? geneInfo.end - genePos : geneInfo.start + genePos;
    const label = String(chrom);
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
  geneInfo,
}) {
  if (!geneSequence) return null;
  const monoFont = '"Courier New", Courier, monospace';

  const normalizedMatches = matchingReads
    .map((m) => {
      const seq = m.read || "";
      if (m.junctions?.length) {
        const first = m.junctions[0];
        const last  = m.junctions[m.junctions.length - 1];
        return {
          ...m, seq,
          start: first.gStart,
          end:   last.gStart + (last.readEnd - last.readStart),
        };
      }
      const start = m.position ?? m.positions?.[0];
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
    if (m.junctions?.length) {
      // Split-read: place each exon segment at its correct gene offset, bridge between them
      const placements = [];

      for (let si = 0; si < m.junctions.length; si++) {
        const seg = m.junctions[si];
        const segGEnd = seg.gStart + (seg.readEnd - seg.readStart);

        const visStart = Math.max(seg.gStart, safeWindowStart);
        const visEnd   = Math.min(segGEnd, windowEnd);
        for (let gi = visStart; gi < visEnd; gi++) {
          const readIdx = seg.readStart + (gi - seg.gStart);
          placements.push([gi - safeWindowStart, m.seq[readIdx] ?? " "]);
        }

        // Bridge to next segment if both are (partially) in this window
        if (si + 1 < m.junctions.length) {
          const nextSeg = m.junctions[si + 1];
          const visBStart = Math.max(segGEnd,       safeWindowStart);
          const visBEnd   = Math.min(nextSeg.gStart, windowEnd);
          for (let gi = visBStart; gi < visBEnd; gi++) {
            placements.push([gi - safeWindowStart, "~"]);
          }
        }
      }

      if (!placements.length) continue;

      let placed = false;
      for (const row of rows) {
        let conflict = false;
        for (const [offset] of placements) {
          if (offset >= 0 && offset < regionLen && row[offset] !== " ") { conflict = true; break; }
        }
        if (!conflict) {
          for (const [offset, ch] of placements) {
            if (offset >= 0 && offset < regionLen) row[offset] = ch;
          }
          placed = true;
          break;
        }
      }
      if (!placed) {
        const newRow = Array(regionLen).fill(" ");
        for (const [offset, ch] of placements) {
          if (offset >= 0 && offset < regionLen) newRow[offset] = ch;
        }
        rows.push(newRow);
      }

    } else {
      // Plain read — existing logic unchanged
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
  }

  const underline =
    windowGene && windowGene.length ? "-".repeat(windowGene.length) : "";

  const splicedCount = visibleMatches.filter((m) => m.source === "spliced").length;

  return (
    <div style={{ ...Styles.pileupContainer, overflowX: "hidden" }}>
      <div style={Styles.pileupWrapper}>
        {geneInfo && (
          <pre style={{ ...Styles.pileupRulerPre, background: "#e8f4f0", borderBottom: "1px solid #cce" }}>
            {renderGenomicRuler(safeWindowStart, regionLen, geneInfo, monoFont)}
          </pre>
        )}
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
          gene pos: {safeWindowStart}–{windowEnd}
          {geneInfo && (() => {
            const minus = geneInfo.strand === -1;
            const c1 = minus ? geneInfo.end - safeWindowStart : geneInfo.start + safeWindowStart;
            const c2 = minus ? geneInfo.end - windowEnd       : geneInfo.start + windowEnd;
            const [lo, hi] = minus ? [c2, c1] : [c1, c2];
            return (
              <span style={{ marginLeft: "0.75rem" }}>
                {geneInfo.seqRegionName}:{lo.toLocaleString()}–{hi.toLocaleString()}
                {minus ? " (−)" : " (+)"}
              </span>
            );
          })()}
          <span style={{ marginLeft: "0.75rem" }}>
            {visibleMatches.length} reads visible
          </span>
          {splicedCount > 0 && (
            <span style={{ marginLeft: "0.75rem", color: "#0a9" }}>
              ({splicedCount} spliced)
            </span>
          )}
        </div>

        {rows.map((row, i) => (
          <pre key={i} style={Styles.pileupRowPre}>
            {renderColoredSequence(row.join(""), monoFont, windowGene)}
          </pre>
        ))}
      </div>
    </div>
  );
}
