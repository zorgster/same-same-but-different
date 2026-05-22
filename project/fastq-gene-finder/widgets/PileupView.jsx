import * as Styles from "../styles/fastq-gene-finder-styles.jsx";
import {
  normalizeSingleRead,
  normalizePairedEntry,
  buildRows,
} from "../utils/pileupLogic.js";

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
  onExportWindowPdf,
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

        <div style={{ margin: "0.25rem 0", fontFamily: monoFont, fontSize: "10px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
          {onExportWindowPdf && (
            <button
              onClick={() => onExportWindowPdf({ windowStart: safeWindowStart, windowEnd, geneSequence, geneInfo, matchingReads, validatedPairs, greyedR1, windowGene })}
              style={{ fontSize: "10px", padding: "1px 6px", cursor: "pointer" }}
            >
              Export Window PDF
            </button>
          )}
          <span>gene pos: {safeWindowStart}–{windowEnd}</span>
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
