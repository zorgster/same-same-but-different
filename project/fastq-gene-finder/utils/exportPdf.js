import { buildRows, normalizeSingleRead, normalizePairedEntry } from "./pileupLogic.js";
import { COLORS } from "../../styles/light-theme.js";

const NUCLEOTIDE_COLORS = {
  A: "#2ca02c",
  C: "#1f77b4",
  G: "#ff7f0e",
  T: "#d62728",
  U: "#d62728",
};
const FORWARD_COLOR   = "#3aa7a3";
const REVERSE_COLOR   = "#b06030";
const INTRON_BG       = "#ebebeb";
const INTRON_LABEL_FG = "#aaaaaa";

// Derive merged gene-relative exon intervals from Ensembl transcript data.
// This is the preferred source — transcript exon coordinates are authoritative.
function exonIntervalsFromTranscripts(transcripts, geneInfo) {
  if (!transcripts?.length || !geneInfo) return null;
  const minus = geneInfo.strand === -1;
  const toG = (cs, ce) => minus
    ? [geneInfo.end - ce, geneInfo.end - cs + 1]
    : [cs - geneInfo.start, ce - geneInfo.start + 1];

  const raw = [];
  for (const t of transcripts) {
    for (const exon of (t.exons || [])) {
      const [gStart, gEnd] = toG(exon.start, exon.end);
      if (gEnd > gStart && gStart >= 0) raw.push({ gStart, gEnd });
    }
  }
  if (!raw.length) return null;

  raw.sort((a, b) => a.gStart - b.gStart);
  const merged = [{ ...raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    if (raw[i].gStart <= last.gEnd) {
      last.gEnd = Math.max(last.gEnd, raw[i].gEnd);
    } else {
      merged.push({ ...raw[i] });
    }
  }
  return merged;
}

// Fallback: parse Ensembl soft-masked sequence (uppercase = annotated feature).
// Less reliable than transcript data — use only when transcripts are not loaded.
function extractExonIntervals(maskedSeq) {
  const intervals = [];
  let start = -1;
  for (let i = 0; i <= maskedSeq.length; i++) {
    const c = maskedSeq[i];
    const isExon = c >= "A" && c <= "Z";
    if (start === -1 && isExon)       start = i;
    else if (start !== -1 && !isExon) { intervals.push({ gStart: start, gEnd: i }); start = -1; }
  }
  return intervals;
}

// Build a compressed x-coordinate mapping.
// Exon regions render at exonPxPerBp px/bp (minimum minExonPx); introns collapse to intronPx px each.
// Returns { scale(genePos) => canvasX, totalWidth, breaks, exonW(b) }
function buildCompressedScale(exonIntervals, exonPxPerBp, intronPx, minExonPx = 4) {
  const MARGIN = 12;
  const exonW  = (e) => Math.max(minExonPx, (e.gEnd - e.gStart) * exonPxPerBp);
  const breaks = [];
  let cx = MARGIN + intronPx; // leading intron space
  for (const e of exonIntervals) {
    breaks.push({ gStart: e.gStart, gEnd: e.gEnd, canvasX: cx });
    cx += exonW(e) + intronPx;
  }
  const totalWidth = cx + MARGIN;

  function scale(genePos) {
    for (let i = 0; i < breaks.length; i++) {
      const b = breaks[i];
      if (genePos < b.gStart) {
        const prevEnd       = i === 0 ? 0 : breaks[i - 1].gEnd;
        const prevCanvasEnd = i === 0
          ? MARGIN
          : breaks[i - 1].canvasX + exonW(breaks[i - 1]);
        const intronLen = b.gStart - prevEnd;
        const progress  = intronLen > 0 ? (genePos - prevEnd) / intronLen : 0;
        return prevCanvasEnd + progress * intronPx;
      }
      if (genePos <= b.gEnd) {
        const frac = (b.gEnd - b.gStart) > 0 ? (genePos - b.gStart) / (b.gEnd - b.gStart) : 0;
        return b.canvasX + frac * exonW(b);
      }
    }
    const last = breaks[breaks.length - 1];
    return last.canvasX + exonW(last) + 2;
  }

  return { scale, totalWidth, breaks, exonW };
}

function computeCoverage(matchingReads, geneLen, readLength) {
  const diff = new Int32Array(geneLen + 1);
  for (const r of matchingReads) {
    const pos = r.position ?? r.positions?.[0];
    if (pos == null || pos < 0 || pos >= geneLen) continue;
    diff[pos]++;
    diff[Math.min(geneLen, pos + readLength)]--;
  }
  const cov = new Uint32Array(geneLen);
  let cur = 0;
  for (let i = 0; i < geneLen; i++) { cur += diff[i]; cov[i] = cur > 0 ? cur : 0; }
  return cov;
}

// ── RNA overview canvas (compressed introns) ─────────────────────────────────
function renderRnaOverviewCanvas({
  geneSequence, maskedGeneSeq, matchingReads, validatedPairs, greyedR1Reads,
  geneInfo, transcripts, readLength,
}) {
  const geneLen = geneSequence.length;
  // Prefer transcript exon boundaries (authoritative); fall back to sequence masking
  const exonIntervals =
    exonIntervalsFromTranscripts(transcripts, geneInfo) ||
    extractExonIntervals(maskedGeneSeq || "");
  if (!exonIntervals.length) return null;

  const totalExonBp = exonIntervals.reduce((s, e) => s + (e.gEnd - e.gStart), 0);
  const exonPxPerBp = Math.max(0.5, Math.min(8, 1600 / Math.max(1, totalExonBp)));
  const INTRON_PX   = 30;
  const MIN_EXON_PX = 20;   // ensure even tiny exons are clearly visible
  const { scale, totalWidth, breaks, exonW } = buildCompressedScale(exonIntervals, exonPxPerBp, INTRON_PX, MIN_EXON_PX);

  // Layout
  const LABEL_H  = 18;
  const COV_H    = 50;
  const GAP      = 4;
  const TX_ROW_H = 11;
  const TX_GAP   = 2;
  const STRIP_H  = 120;

  const numTx       = transcripts?.length ?? 0;
  const txBlockH    = numTx > 0 ? (14 + numTx * (TX_ROW_H + TX_GAP) + GAP) : 0;
  const canvasH     = LABEL_H + COV_H + GAP + txBlockH + GAP + STRIP_H + 4;

  // 2× scale for crisp PDF embedding (same logical coordinates, double physical pixels)
  const SCALE = 2;
  const canvas = document.createElement("canvas");
  canvas.width  = totalWidth * SCALE;
  canvas.height = canvasH   * SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalWidth, canvasH);

  // Intron bands (full height, drawn first so other content overlaps)
  for (let i = 0; i < breaks.length; i++) {
    const b         = breaks[i];
    const bExonW    = exonW(b);
    const bandStart = b.canvasX + bExonW;
    const bandEnd   = i + 1 < breaks.length ? breaks[i + 1].canvasX : bandStart + INTRON_PX;
    const iLen      = i + 1 < exonIntervals.length
      ? exonIntervals[i + 1].gStart - exonIntervals[i].gEnd
      : 0;

    ctx.fillStyle = INTRON_BG;
    ctx.fillRect(bandStart, LABEL_H, bandEnd - bandStart, canvasH - LABEL_H);

    if (iLen > 0 && bandEnd > bandStart + 4) {
      ctx.fillStyle = INTRON_LABEL_FG;
      ctx.font = "8px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const label = iLen >= 1000 ? `${(iLen / 1000).toFixed(1)}k` : `${iLen}`;
      ctx.fillText(label, (bandStart + bandEnd) / 2, LABEL_H + 2);
    }
  }

  // Also leading intron band
  if (breaks.length && breaks[0].canvasX > 12) {
    ctx.fillStyle = INTRON_BG;
    ctx.fillRect(12, LABEL_H, breaks[0].canvasX - 12, canvasH - LABEL_H);
  }

  // Coordinate labels (one per exon)
  ctx.fillStyle = "#555555";
  ctx.font = "9px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const minus = geneInfo?.strand === -1;
  for (const b of breaks) {
    const chromPos = minus
      ? (geneInfo.end || 0) - b.gStart
      : (geneInfo.start || 0) + b.gStart;
    ctx.fillText(String(chromPos), b.canvasX, LABEL_H / 2);
  }

  // Coverage histogram per exon
  const covY     = LABEL_H;
  const coverage = computeCoverage(matchingReads, geneLen, readLength);
  let maxCov = 1;
  for (let i = 0; i < coverage.length; i++) if (coverage[i] > maxCov) maxCov = coverage[i];

  for (const b of breaks) {
    const bExonW   = exonW(b);
    const binCount = Math.ceil(bExonW);
    const exonBp   = b.gEnd - b.gStart;
    ctx.beginPath();
    for (let bx = 0; bx <= binCount; bx++) {
      const gs  = b.gStart + Math.floor((bx / binCount) * exonBp);
      const ge  = b.gStart + Math.floor(((bx + 1) / binCount) * exonBp);
      let sum = 0;
      for (let i = gs; i < ge && i < geneLen; i++) sum += coverage[i];
      const avg = sum / Math.max(1, ge - gs);
      const y   = covY + COV_H - Math.round((avg / maxCov) * (COV_H - 4));
      bx === 0 ? ctx.moveTo(b.canvasX + bx, y) : ctx.lineTo(b.canvasX + bx, y);
    }
    ctx.strokeStyle = FORWARD_COLOR;
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Filled area
    ctx.beginPath();
    ctx.moveTo(b.canvasX, covY + COV_H);
    for (let bx = 0; bx <= binCount; bx++) {
      const gs  = b.gStart + Math.floor((bx / binCount) * exonBp);
      const ge  = b.gStart + Math.floor(((bx + 1) / binCount) * exonBp);
      let sum = 0;
      for (let i = gs; i < ge && i < geneLen; i++) sum += coverage[i];
      const avg = sum / Math.max(1, ge - gs);
      const y   = covY + COV_H - Math.round((avg / maxCov) * (COV_H - 4));
      ctx.lineTo(b.canvasX + bx, y);
    }
    ctx.lineTo(b.canvasX + bExonW, covY + COV_H);
    ctx.closePath();
    ctx.fillStyle = FORWARD_COLOR + "28";
    ctx.fill();
  }

  ctx.fillStyle = "#888";
  ctx.font = "8px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`max ${maxCov}`, 2, covY + 2);

  // Transcript rows
  if (transcripts?.length && geneInfo) {
    const txY = covY + COV_H + GAP;
    ctx.fillStyle = "#888";
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Transcripts", 2, txY);

    const txStartY = txY + 14;
    const toG = (cs, ce) => minus
      ? [geneInfo.end - ce, geneInfo.end - cs + 1]
      : [cs - geneInfo.start, ce - geneInfo.start + 1];

    const regionCoveredByCov = (gStart, gEnd) => {
      let sum = 0;
      const s = Math.max(0, gStart), e = Math.min(geneLen, gEnd);
      for (let i = s; i < e; i++) sum += coverage[i];
      return sum / Math.max(1, e - s) >= 0.5;
    };

    for (let ti = 0; ti < transcripts.length; ti++) {
      const t    = transcripts[ti];
      const rowY = txStartY + ti * (TX_ROW_H + TX_GAP);
      const midY = rowY + TX_ROW_H / 2;

      const [tGS, tGE] = toG(t.start, t.end);
      ctx.strokeStyle = t.isCanonical ? COLORS.accent : COLORS.border;
      ctx.lineWidth   = t.isCanonical ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(scale(Math.max(0, tGS)), midY);
      ctx.lineTo(scale(Math.min(geneLen, tGE)), midY);
      ctx.stroke();

      for (const exon of t.exons) {
        const [eGS, eGE] = toG(exon.start, exon.end);
        if (eGE <= 0 || eGS >= geneLen) continue;
        const ex1 = scale(Math.max(0, eGS));
        const ex2 = scale(Math.min(geneLen, eGE));
        const covered = regionCoveredByCov(eGS, eGE);
        ctx.fillStyle = covered
          ? (t.isCanonical ? COLORS.accent : COLORS.success)
          : (COLORS.muted + "55");
        ctx.fillRect(ex1, rowY, Math.max(2, ex2 - ex1), TX_ROW_H);
      }
    }
  }

  // Read density strip
  const txBlockUsed = numTx > 0 ? COV_H + GAP + txBlockH + GAP : COV_H + GAP * 2;
  const stripY      = LABEL_H + txBlockUsed;
  const ROW_H       = 5;
  const ROW_GAP     = 2;
  const MAX_ROWS    = Math.floor(STRIP_H / (ROW_H + ROW_GAP));
  const rowRanges   = [];

  function placeAt(xStart, xEnd) {
    const w = Math.max(2, xEnd - xStart);
    for (let r = 0; r < rowRanges.length; r++) {
      if (!rowRanges[r].some(([a, b]) => xStart < b && xStart + w > a)) {
        rowRanges[r].push([xStart, xStart + w]);
        return r;
      }
    }
    if (rowRanges.length < MAX_ROWS) { rowRanges.push([[xStart, xStart + w]]); return rowRanges.length - 1; }
    return -1;
  }

  function drawRead(xStart, xEnd, color, rowIndex, alpha = 0.75) {
    const ry = stripY + (rowIndex < 0 ? 0 : rowIndex) * (ROW_H + ROW_GAP);
    ctx.globalAlpha = rowIndex < 0 ? 0.15 : alpha;
    ctx.fillStyle   = color;
    ctx.fillRect(xStart, ry, Math.max(2, xEnd - xStart), ROW_H);
    ctx.globalAlpha = 1;
    return ry;
  }

  // Pairs
  for (const p of (validatedPairs || [])) {
    const { r1, r2 } = p;
    const r1Pos = r1?.position ?? r1?.positions?.[0];
    const r2Pos = r2?.position ?? r2?.positions?.[0];
    if (r1Pos == null || r2Pos == null) continue;
    const x1s = scale(r1Pos);
    const x1e = scale(r1Pos + (r1.read?.length ?? readLength));
    const x2s = scale(r2Pos);
    const x2e = scale(r2Pos + (r2.read?.length ?? readLength));
    const row  = placeAt(Math.min(x1s, x2s), Math.max(x1e, x2e));
    const ry   = drawRead(x1s, x1e, (r1.orientation === "forward" ? FORWARD_COLOR : REVERSE_COLOR), row);
    drawRead(x2s, x2e, (r2.orientation === "forward" ? FORWARD_COLOR : REVERSE_COLOR), row);
    // Dotted insert line
    const [lEnd, rStart] = x1e < x2s ? [x1e, x2s] : [x2e, x1s];
    if (rStart > lEnd) {
      ctx.globalAlpha = row < 0 ? 0.15 : 0.7;
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = "#888888";
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(lEnd, ry + ROW_H / 2); ctx.lineTo(rStart, ry + ROW_H / 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // Single reads (confirmed + greyed)
  const allSingle = [
    ...(matchingReads || []).map(r => ({ r, grey: false })),
    ...(greyedR1Reads || []).map(r => ({ r, grey: true })),
  ];
  for (const { r, grey } of allSingle) {
    const color = grey ? "#cccccc" : (r.orientation === "forward" ? FORWARD_COLOR : REVERSE_COLOR);

    if (r.junctions?.length) {
      const firstJ = r.junctions[0];
      const lastJ  = r.junctions[r.junctions.length - 1];
      const xMin   = scale(firstJ.gStart);
      const xMax   = scale(lastJ.gStart + (lastJ.readEnd - lastJ.readStart));
      const row    = placeAt(xMin, xMax);
      for (let i = 0; i < r.junctions.length; i++) {
        const j   = r.junctions[i];
        const jX1 = scale(j.gStart);
        const jX2 = scale(j.gStart + (j.readEnd - j.readStart));
        drawRead(jX1, jX2, color, row, grey ? 0.4 : 0.9);
        if (i < r.junctions.length - 1) {
          const nextJ = r.junctions[i + 1];
          const ry    = stripY + (row < 0 ? 0 : row) * (ROW_H + ROW_GAP);
          ctx.globalAlpha = row < 0 ? 0.15 : (grey ? 0.4 : 1.0);
          ctx.strokeStyle = color;
          ctx.lineWidth   = 1.5;
          ctx.beginPath(); ctx.moveTo(jX2, ry + ROW_H / 2); ctx.lineTo(scale(nextJ.gStart), ry + ROW_H / 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    } else {
      const pos = r.position ?? r.positions?.[0];
      if (pos == null) continue;
      const xStart = scale(pos);
      const xEnd   = scale(pos + (r.read?.length ?? readLength));
      const row    = placeAt(xStart, xEnd);
      drawRead(xStart, xEnd, color, row, grey ? 0.4 : 0.75);
    }
  }

  // Exon boundary tick marks
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth   = 0.5;
  for (const b of breaks) {
    const x1 = b.canvasX;
    const x2 = b.canvasX + exonW(b);
    for (const x of [x1, x2]) {
      ctx.beginPath(); ctx.moveTo(x, LABEL_H); ctx.lineTo(x, canvasH); ctx.stroke();
    }
  }

  return canvas;
}

// ── Zoom window pileup canvas ─────────────────────────────────────────────────
function renderPileupWindowCanvas({ windowStart, windowEnd, geneSequence, geneInfo, matchingReads, validatedPairs, greyedR1 }) {
  const windowGene = geneSequence.slice(windowStart, windowEnd);
  const regionLen  = windowGene.length;

  const normalizedSingle = (matchingReads || [])
    .map(normalizeSingleRead).filter(m => Number.isFinite(m.start)).sort((a, b) => a.start - b.start);
  const normalizedPairs = (validatedPairs || [])
    .map(normalizePairedEntry).filter(m => Number.isFinite(m.start)).sort((a, b) => a.start - b.start);
  const normalizedGreyed = (greyedR1 || [])
    .map(normalizeSingleRead).filter(m => Number.isFinite(m.start)).sort((a, b) => a.start - b.start);

  const allConfirmed = [...normalizedSingle, ...normalizedPairs].sort((a, b) => a.start - b.start);
  const visConfirmed = allConfirmed.filter(m => m.start < windowEnd && m.end > windowStart);
  const visGreyed    = normalizedGreyed.filter(m => m.start < windowEnd && m.end > windowStart);

  const rows     = buildRows(visConfirmed, windowStart, windowEnd, regionLen);
  const greyRows = buildRows(visGreyed,    windowStart, windowEnd, regionLen);

  const CW      = 7.2;  // px per monospace char at 12px
  const CH      = 14;   // row height px
  const FONT    = "12px 'Courier New', Courier, monospace";
  const HEADER  = geneInfo ? 4 : 3; // rows: genomic ruler (optional), ref seq, coord ruler, underline
  const totalRows = HEADER + rows.length + (greyRows.length > 0 ? 1 + greyRows.length : 0);

  const canvas = document.createElement("canvas");
  canvas.width  = Math.ceil(regionLen * CW) + 4;
  canvas.height = totalRows * CH + 4;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = FONT;
  ctx.textBaseline = "top";

  let rowY = 2;

  // Genomic coordinate ruler
  if (geneInfo) {
    ctx.fillStyle = "#6688aa";
    const minus      = geneInfo.strand === -1;
    const firstMark  = Math.ceil(windowStart / 25) * 25;
    for (let gp = firstMark; gp < windowEnd; gp += 25) {
      const offset    = gp - windowStart;
      const chromPos  = minus ? geneInfo.end - gp : geneInfo.start + gp;
      ctx.fillText(String(chromPos), offset * CW, rowY);
    }
    rowY += CH;
  }

  // Reference sequence (coloured bases)
  for (let i = 0; i < regionLen; i++) {
    const base = windowGene[i] || " ";
    ctx.fillStyle = NUCLEOTIDE_COLORS[base.toUpperCase()] || "#333333";
    ctx.fillText(base, i * CW, rowY);
  }
  rowY += CH;

  // Gene-position coordinate ruler
  ctx.fillStyle = "#888888";
  const rulerChars = Array(regionLen).fill(" ");
  for (let off = 0; off < regionLen; off += 10) {
    const label = String(windowStart + off);
    for (let i = 0; i < label.length && off + i < regionLen; i++) rulerChars[off + i] = label[i];
  }
  ctx.fillText(rulerChars.join(""), 0, rowY);
  rowY += CH;

  // Underline
  ctx.fillStyle = "#cccccc";
  ctx.fillText("-".repeat(regionLen), 0, rowY);
  rowY += CH;

  // Confirmed read rows
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const ch  = row[i];
      if (ch === " ") continue;
      const ref = windowGene[i];
      // Mismatch background
      if (ref && ch !== "=" && ch !== "~" && ch.toUpperCase() !== ref.toUpperCase()) {
        ctx.fillStyle = "rgba(255,200,0,0.45)";
        ctx.fillRect(i * CW, rowY, CW, CH);
      }
      ctx.fillStyle = ch === "=" ? "#9932cc" : ch === "~" ? "#888888" : (NUCLEOTIDE_COLORS[ch.toUpperCase()] || "#333333");
      ctx.fillText(ch, i * CW, rowY);
    }
    rowY += CH;
  }

  // Greyed reads
  if (greyRows.length) {
    ctx.fillStyle = "#aaaaaa";
    ctx.font      = "9px monospace";
    ctx.fillText("─── unconfirmed ───", 0, rowY + 2);
    ctx.font      = FONT;
    rowY          += CH;
    for (const row of greyRows) {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === " ") continue;
        ctx.globalAlpha = 0.4;
        ctx.fillStyle   = NUCLEOTIDE_COLORS[ch.toUpperCase()] || "#888888";
        ctx.fillText(ch, i * CW, rowY);
        ctx.globalAlpha = 1;
      }
      rowY += CH;
    }
  }

  return canvas;
}

function cleanFileName(name) {
  return (name || "")
    .replace(/\.(fastq\.gz|fastq|fq\.gz|fq|gz|bam)$/i, "")
    .replace(/[_\-\s][Rr]?[12]$/i, "");
}

// ── Public: full-gene overview PDF ───────────────────────────────────────────
export async function exportOverviewPdf({
  seqMode, geneName, geneInfo, geneSequence, maskedGeneSeq, seedArrays,
  matchingReads, validatedPairs, greyedR1Reads,
  coverageDataUrl, coverageDimensions, coverageTranscripts, readLength,
  fileName,
}) {
  const { jsPDF } = await import("jspdf");

  const MARGIN = 12;
  const isRna  = seqMode === "RNA";
  const doc    = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW     = 297;
  const PH     = 210;
  const CW     = PW - 2 * MARGIN;
  let y        = MARGIN;

  // jsPDF default fonts use WinAnsi — keep text pure ASCII (no Unicode dashes, no toLocaleString)
  const chr         = geneInfo?.seqRegionName || geneInfo?.seq_region_name || "";
  const strand      = geneInfo?.strand === -1 ? "(-)" : "(+)";
  const assembly    = geneInfo?.assembly || "";
  const ensId       = geneInfo?.id || "";
  const ensVersion  = geneInfo?.version != null ? `.${geneInfo.version}` : "";
  const displayName = geneName || geneInfo?.displayName || geneInfo?.display_name || geneInfo?.name || "Gene";
  const cleanFile   = cleanFileName(fileName);

  // Line 1: "GRIA1 in R3766_C0VJYACXX_GATCAG_L004"
  const titleLine = cleanFile ? `${displayName} in ${cleanFile}` : displayName;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(titleLine, MARGIN, y); y += 7;

  doc.setFont("helvetica", "normal"); doc.setFontSize(9);

  // Line 2: Ensembl ID.version (only if available)
  if (ensId) {
    doc.text(`${ensId}${ensVersion}`, MARGIN, y); y += 5;
  }

  // Line 3: coordinates
  const assemblyPrefix = assembly ? `(${assembly}) ` : "";
  doc.text(
    `${assemblyPrefix}${chr}:${geneInfo?.start}-${geneInfo?.end}  strand: ${strand}  mode: ${seqMode}  gene: ${geneSequence?.length} bp`,
    MARGIN, y,
  ); y += 5;

  // Line 4: read/pair/seed counts
  doc.text(
    `${matchingReads.length} matching reads  |  ${validatedPairs.length} pairs  |  ${seedArrays.length} seeds`,
    MARGIN, y,
  ); y += 7;

  // CoverageOverview canvas (both modes)
  if (coverageDataUrl && coverageDimensions?.w && coverageDimensions?.h) {
    const imgH = Math.min(80, CW * (coverageDimensions.h / coverageDimensions.w));
    doc.addImage(coverageDataUrl, "PNG", MARGIN, y, CW, imgH);
    y += imgH + 4;
  }

  // RNA compressed read density strip
  if (isRna && maskedGeneSeq) {
    const stripCanvas = renderRnaOverviewCanvas({
      geneSequence, maskedGeneSeq, matchingReads, validatedPairs: validatedPairs || [],
      greyedR1Reads: greyedR1Reads || [], geneInfo,
      transcripts: coverageTranscripts || null, readLength,
    });
    if (stripCanvas) {
      const stripDataUrl = stripCanvas.toDataURL("image/png");
      const stripMmH     = CW * (stripCanvas.height / stripCanvas.width);
      if (y + stripMmH > PH - MARGIN) { doc.addPage(); y = MARGIN; }
      doc.addImage(stripDataUrl, "PNG", MARGIN, y, CW, Math.min(stripMmH, PH - y - MARGIN));
      y += Math.min(stripMmH, PH - y - MARGIN) + 2;
      doc.setFontSize(7);
      doc.setTextColor(140, 140, 140);
      doc.text("Compressed scale: introns collapsed · teal = forward · amber = reverse", MARGIN, y);
      doc.setTextColor(0, 0, 0);
    }
  }

  doc.save(`fgf-${geneInfo?.name || "export"}-overview.pdf`);
}

// ── Public: zoom window PDF ──────────────────────────────────────────────────
export async function exportZoomWindowPdf({
  windowStart, windowEnd, geneSequence, geneInfo, matchingReads, validatedPairs, greyedR1,
}) {
  const { jsPDF } = await import("jspdf");

  const canvas  = renderPileupWindowCanvas({ windowStart, windowEnd, geneSequence, geneInfo, matchingReads, validatedPairs, greyedR1 });
  const dataUrl = canvas.toDataURL("image/png");

  const MARGIN = 12;
  // Choose orientation so image fits without scaling below legibility
  const portraitW  = 210 - 2 * MARGIN;
  const portraitH  = portraitW * (canvas.height / canvas.width);
  const orientation = portraitH <= 297 - 2 * MARGIN - 20 ? "portrait" : "landscape";

  const doc    = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW  = orientation === "landscape" ? 297 : 210;
  const pageH  = orientation === "landscape" ? 210 : 297;
  const contW  = pageW - 2 * MARGIN;
  const contH  = pageH - 2 * MARGIN;
  let y        = MARGIN;

  // Header — ASCII only (jsPDF WinAnsi font)
  const displayName = geneInfo?.display_name || geneInfo?.name || "Pileup Window";
  doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(displayName, MARGIN, y); y += 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const minus = geneInfo?.strand === -1;
  const c1    = minus ? (geneInfo.end || 0) - windowStart : (geneInfo.start || 0) + windowStart;
  const c2    = minus ? (geneInfo.end || 0) - windowEnd   : (geneInfo.start || 0) + windowEnd;
  const [lo, hi] = minus ? [c2, c1] : [c1, c2];
  const chr   = geneInfo?.seqRegionName || geneInfo?.seq_region_name || "";
  doc.text(
    `gene pos ${windowStart}-${windowEnd}  |  ${chr}:${lo}-${hi}  |  ${(matchingReads?.length ?? 0) + (validatedPairs?.length ?? 0)} reads`,
    MARGIN, y,
  ); y += 5;

  const imgH = Math.min(contH - (y - MARGIN), contW * (canvas.height / canvas.width));
  doc.addImage(dataUrl, "PNG", MARGIN, y, contW, imgH);

  const geneName = geneInfo?.name || "window";
  doc.save(`fgf-${geneName}-${windowStart}-${windowEnd}.pdf`);
}
