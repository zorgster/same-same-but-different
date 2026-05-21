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
    if (char === "=") {
      return <span key={index} style={{ color: Styles.spliceConnectorColor, fontFamily: monoFont }}>═</span>;
    }
    if (char === "~") {
      return <span key={index} style={{ color: Styles.pairConnectorColor, fontFamily: monoFont }}>~</span>;
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

function normalizeSingleRead(m) {
  const seq = m.read || "";
  if (m.junctions?.length) {
    const first = m.junctions[0];
    const last  = m.junctions[m.junctions.length - 1];
    return {
      ...m, seq,
      start: first.gStart,
      end:   last.gStart + (last.readEnd - last.readStart),
      bridgeChar: "=",
    };
  }
  const start = m.position ?? m.positions?.[0];
  return {
    ...m,
    start,
    end: Number.isFinite(start) ? start + Math.max(1, seq.length) : NaN,
    seq,
  };
}

// Build segments for one end of a pair, offsetting readStart/End into combinedSeq.
// Internal exon gaps use bridgeAfter "=" ; the final segment carries bridgeAfter for the
// inter-read gap (either "~" for the insert, or undefined for the last segment of R2).
function buildEndSegments(read, seqOffset, finalBridgeAfter) {
  const seq   = read.read || "";
  const pos   = read.position ?? read.positions?.[0] ?? 0;
  const segs  = [];
  let offset  = seqOffset;

  if (read.junctions?.length) {
    for (let i = 0; i < read.junctions.length; i++) {
      const j   = read.junctions[i];
      const len = j.readEnd - j.readStart;
      segs.push({
        gStart:     j.gStart,
        readStart:  offset,
        readEnd:    offset + len,
        bridgeAfter: i < read.junctions.length - 1 ? "=" : finalBridgeAfter,
      });
      offset += len;
    }
    return { segs, seq: read.junctions.map(j => seq.slice(j.readStart, j.readEnd)).join(""), seqEnd: offset };
  }

  segs.push({
    gStart:     pos,
    readStart:  offset,
    readEnd:    offset + seq.length,
    bridgeAfter: finalBridgeAfter,
  });
  return { segs, seq, seqEnd: offset + seq.length };
}

function normalizePairedEntry({ r1, r2 }) {
  // Always put the genomically earlier read first so the insert gap reads left→right
  const r1Pos = r1.position ?? r1.positions?.[0] ?? 0;
  const r2Pos = r2.position ?? r2.positions?.[0] ?? 0;
  const [first, second] = r1Pos <= r2Pos ? [r1, r2] : [r2, r1];

  const { segs: firstSegs, seq: firstSeq, seqEnd: firstEnd } =
    buildEndSegments(first, 0, "~");
  const { segs: secondSegs, seq: secondSeq } =
    buildEndSegments(second, firstEnd, undefined);

  const junctions   = [...firstSegs, ...secondSegs];
  const combinedSeq = firstSeq + secondSeq;
  const lastJunc    = junctions[junctions.length - 1];

  return {
    type:     "pair",
    seq:      combinedSeq,
    start:    junctions[0].gStart,
    end:      lastJunc.gStart + (lastJunc.readEnd - lastJunc.readStart),
    junctions,
  };
}

function buildRows(entries, safeWindowStart, windowEnd, regionLen) {
  const rows = [];

  for (const m of entries) {
    if (m.junctions?.length) {
      const defaultBridge = m.bridgeChar ?? "=";
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

        // Bridge to next segment — use per-segment bridgeAfter if set, else entry default
        if (si + 1 < m.junctions.length) {
          const nextSeg   = m.junctions[si + 1];
          const bridge    = seg.bridgeAfter !== undefined ? seg.bridgeAfter : defaultBridge;
          const visBStart = Math.max(segGEnd,        safeWindowStart);
          const visBEnd   = Math.min(nextSeg.gStart, windowEnd);
          for (let gi = visBStart; gi < visBEnd; gi++) {
            placements.push([gi - safeWindowStart, bridge]);
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
      const offset = Math.max(0, m.start - safeWindowStart);
      const clipStart = Math.max(0, safeWindowStart - m.start);
      const clipEnd = Math.min(m.seq.length, windowEnd - m.start);
      const clippedSeq = m.seq.slice(clipStart, clipEnd);

      if (!clippedSeq.length) continue;

      let placed = false;
      for (const row of rows) {
        let conflict = false;
        for (let i = 0; i < clippedSeq.length && offset + i < regionLen; i++) {
          if (row[offset + i] !== " ") { conflict = true; break; }
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

  return rows;
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
  validatedPairs = [],
  greyedR1 = [],
}) {
  if (!geneSequence) return null;
  const monoFont = '"Courier New", Courier, monospace';

  // Normalize all sources into a unified format
  const normalizedSingle = matchingReads
    .map(normalizeSingleRead)
    .filter((m) => Number.isFinite(m.start))
    .sort((a, b) => a.start - b.start);

  const normalizedPairs = validatedPairs
    .map(normalizePairedEntry)
    .filter((m) => Number.isFinite(m.start))
    .sort((a, b) => a.start - b.start);

  const normalizedGreyed = greyedR1
    .map(normalizeSingleRead)
    .filter((m) => Number.isFinite(m.start))
    .sort((a, b) => a.start - b.start);

  const allConfirmed = [...normalizedSingle, ...normalizedPairs].sort((a, b) => a.start - b.start);

  if (!allConfirmed.length && !normalizedGreyed.length) {
    return (
      <div style={{ border: "1px solid #ccc", marginTop: "0.5rem", padding: "0.5rem", fontFamily: monoFont }}>
        No matching reads to display yet.
      </div>
    );
  }

  const maxStart = Math.max(0, geneSequence.length - windowSize);
  const safeWindowStart = Math.max(0, Math.min(maxStart, windowStart));
  const windowEnd = Math.min(geneSequence.length, safeWindowStart + windowSize);

  const windowGene = geneSequence.slice(safeWindowStart, windowEnd);
  const regionLen = Math.max(1, windowGene.length);

  const visibleConfirmed = allConfirmed.filter(
    (m) => m.start < windowEnd && m.end > safeWindowStart,
  );
  const visibleGreyed = normalizedGreyed.filter(
    (m) => m.start < windowEnd && m.end > safeWindowStart,
  );

  const rows      = buildRows(visibleConfirmed, safeWindowStart, windowEnd, regionLen);
  const greyRows  = buildRows(visibleGreyed,    safeWindowStart, windowEnd, regionLen);

  const underline = windowGene.length ? "-".repeat(windowGene.length) : "";

  const splicedCount = visibleConfirmed.filter((m) => m.source === "spliced").length;
  const pairedCount  = visibleConfirmed.filter((m) => m.type === "pair").length;

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

        <div style={{ margin: "0.25rem 0", fontFamily: monoFont, fontSize: "10px" }}>
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
            {visibleConfirmed.length} reads visible
          </span>
          {splicedCount > 0 && (
            <span style={{ marginLeft: "0.75rem", color: Styles.spliceConnectorColor }}>
              ({splicedCount} spliced, ═ = intron)
            </span>
          )}
          {pairedCount > 0 && (
            <span style={{ marginLeft: "0.75rem", color: Styles.pairConnectorColor }}>
              ({pairedCount} pairs, ~ = insert)
            </span>
          )}
        </div>

        {rows.map((row, i) => (
          <pre key={i} style={Styles.pileupRowPre}>
            {renderColoredSequence(row.join(""), monoFont, windowGene)}
          </pre>
        ))}

        {greyRows.length > 0 && (
          <>
            <pre style={{ ...Styles.pileupUnderlinePre, fontSize: "9px", opacity: 0.5 }}>
              {"─── unconfirmed (no R2 match) ───"}
            </pre>
            {greyRows.map((row, i) => (
              <pre key={`grey-${i}`} style={{ ...Styles.pileupRowPre, opacity: 0.35 }}>
                {renderColoredSequence(row.join(""), monoFont, windowGene)}
              </pre>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
