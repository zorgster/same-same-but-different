import {
  useRef,
  useEffect,
  useMemo,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { COLORS } from "../../styles/light-theme";
import TranscriptZoomModal from "./TranscriptZoomModal.jsx";

// ── Layout constants ────────────────────────────────────────────────────────
const COV_H = 68;
const EXON_H = 14; // inferred exon/intron track from reads
const GENE_H = 10; // chromosome coordinate bar
const GAP = 3;
const TX_HEADER_H = 13; // "Transcripts" section label
const TX_ROW_H = 10;
const TX_ROW_GAP = 2;

const COV_THRESHOLD = 0.3; // binned reads/bp to call a region covered (inferred track)
const EXON_COV_MIN = 0.1; // reads/bp in coverageArray to colour an annotated exon

function canvasH(numTranscripts) {
  const txArea =
    numTranscripts > 0
      ? GAP + TX_HEADER_H + numTranscripts * (TX_ROW_H + TX_ROW_GAP)
      : 0;
  return COV_H + GAP + EXON_H + txArea + GAP + GENE_H;
}

// Evidence-based colour tiers for transcript backbone and exon rectangles
function txColors(t, txEvidence) {
  const ev = txEvidence?.get(t.id);
  if (!ev) {
    return {
      backbone: t.isCanonical ? COLORS.accent : COLORS.border,
      lw: t.isCanonical ? 1.5 : 0.5,
      exonCovered: t.isCanonical ? COLORS.accent : COLORS.muted + "55",
      exonUncovered: COLORS.muted + "22",
    };
  }
  const f = ev.fraction;
  if (f >= 0.5)
    return {
      backbone: COLORS.accent,
      lw: 1.5,
      exonCovered: COLORS.accent,
      exonUncovered: COLORS.muted + "55",
    };
  if (f >= 0.2)
    return {
      backbone: "#5a9a5a",
      lw: 1,
      exonCovered: COLORS.success,
      exonUncovered: COLORS.muted + "55",
    };
  if (f >= 0.01)
    return {
      backbone: COLORS.muted,
      lw: 1,
      exonCovered: COLORS.muted + "88",
      exonUncovered: COLORS.muted + "33",
    };
  return {
    backbone: COLORS.border,
    lw: 0.5,
    exonCovered: COLORS.muted + "55",
    exonUncovered: COLORS.muted + "22",
  };
}

// ── Component ───────────────────────────────────────────────────────────────
const CoverageOverview = forwardRef(function CoverageOverview(
  {
    geneSequence,
    matchingReads,
    readLength = 100,
    windowStart,
    windowSize,
    onWindowJump,
    geneInfo,
    onExportPdf,
    isPdfExporting = false,
    transcripts = null, // [{id, biotype, isCanonical, start, end, exons[]}] from FastqGeneFinder
    txEvidence = null, // Map<txId, {count, fraction}> from FastqGeneFinder
  },
  ref,
) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [showZoom, setShowZoom] = useState(false);
  const [hoveredTx, setHoveredTx] = useState(null); // { tx, clientX, clientY, idx }

  useImperativeHandle(
    ref,
    () => ({
      getCanvasDataUrl: () => canvasRef.current?.toDataURL("image/png") ?? null,
      getCanvasDimensions: () =>
        canvasRef.current
          ? { w: canvasRef.current.width, h: canvasRef.current.height }
          : null,
    }),
    [],
  );

  // Container resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setCanvasWidth(w);
    });
    obs.observe(el);
    const w = Math.floor(el.getBoundingClientRect().width);
    if (w > 0) setCanvasWidth(w);
    return () => obs.disconnect();
  }, []);

  // Sort transcripts by evidence fraction desc, then canonical, then protein_coding, then id
  const sortedTranscripts = useMemo(() => {
    if (!transcripts?.length) return [];
    return [...transcripts].sort((a, b) => {
      const fa = txEvidence?.get(a.id)?.fraction ?? -1;
      const fb = txEvidence?.get(b.id)?.fraction ?? -1;
      if (fb !== fa) return fb - fa;
      if (b.isCanonical !== a.isCanonical)
        return (b.isCanonical ? 1 : 0) - (a.isCanonical ? 1 : 0);
      const aPC = a.biotype === "protein_coding" ? 1 : 0;
      const bPC = b.biotype === "protein_coding" ? 1 : 0;
      if (bPC !== aPC) return bPC - aPC;
      return (a.id || "").localeCompare(b.id || "");
    });
  }, [transcripts, txEvidence]);

  // Per-position coverage via difference array
  const coverageArray = useMemo(() => {
    const geneLen = geneSequence?.length;
    if (!geneLen || !matchingReads.length) return null;
    const diff = new Int32Array(geneLen + 1);
    for (const read of matchingReads) {
      const pos = read.position;
      if (pos == null || !Number.isFinite(pos) || pos < 0 || pos >= geneLen)
        continue;
      diff[pos]++;
      diff[Math.min(geneLen, pos + readLength)]--;
    }
    const cov = new Uint32Array(geneLen);
    let cur = 0;
    for (let i = 0; i < geneLen; i++) {
      cur += diff[i];
      cov[i] = cur > 0 ? cur : 0;
    }
    return cov;
  }, [geneSequence, matchingReads, readLength]);

  // Check if a gene-relative region has read coverage
  const regionCovered = (gStart, gEnd) => {
    if (!coverageArray) return false;
    const s = Math.max(0, gStart);
    const e = Math.min(coverageArray.length, gEnd);
    if (e <= s) return false;
    let sum = 0;
    for (let i = s; i < e; i++) sum += coverageArray[i];
    return sum / (e - s) >= EXON_COV_MIN;
  };

  // ── Draw ───────────────────────────────────────────────────────────────────
  const numTx = sortedTranscripts.length;
  const H = canvasH(numTx);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvasWidth;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const geneLen = geneSequence?.length;

    // ── Y positions ───────────────────────────────────────────
    const exonY = COV_H + GAP;
    const txAreaY = exonY + EXON_H + GAP;
    const geneBarY =
      numTx > 0
        ? txAreaY + TX_HEADER_H + numTx * (TX_ROW_H + TX_ROW_GAP) + GAP
        : txAreaY + GAP;

    // ── Gene coordinate bar ───────────────────────────────────
    ctx.fillStyle = COLORS.border;
    ctx.fillRect(0, geneBarY, W, GENE_H);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "9px monospace";
    ctx.textBaseline = "middle";
    const barMidY = geneBarY + GENE_H / 2;
    if (geneInfo) {
      const minus = geneInfo.strand === -1;
      const lbl = `${geneInfo.seqRegionName}:${(minus ? geneInfo.end : geneInfo.start).toLocaleString()}`;
      const rbl = (minus ? geneInfo.start : geneInfo.end).toLocaleString();
      ctx.fillText(lbl, 3, barMidY);
      ctx.fillText(rbl, W - ctx.measureText(rbl).width - 3, barMidY);
    } else if (geneLen) {
      ctx.fillText("0", 3, barMidY);
      const el = String(geneLen);
      ctx.fillText(el, W - ctx.measureText(el).width - 3, barMidY);
    }

    if (!coverageArray || !geneLen) return;

    // ── Bin coverage to canvas width ──────────────────────────
    const bins = new Float32Array(W);
    for (let b = 0; b < W; b++) {
      const gs = Math.floor((b / W) * geneLen);
      const ge = Math.max(gs + 1, Math.floor(((b + 1) / W) * geneLen));
      let sum = 0;
      for (let i = gs; i < ge && i < geneLen; i++) sum += coverageArray[i];
      bins[b] = sum / (ge - gs);
    }
    const maxCov = Math.max(...bins, 1);

    // ── Coverage filled area ──────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(0, COV_H);
    for (let b = 0; b < W; b++)
      ctx.lineTo(b, COV_H - (bins[b] / maxCov) * (COV_H - 6));
    ctx.lineTo(W, COV_H);
    ctx.closePath();
    ctx.fillStyle = COLORS.accent + "28";
    ctx.fill();

    ctx.beginPath();
    for (let b = 0; b < W; b++) {
      const y = COV_H - (bins[b] / maxCov) * (COV_H - 6);
      b === 0 ? ctx.moveTo(b, y) : ctx.lineTo(b, y);
    }
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = COLORS.muted;
    ctx.font = "9px monospace";
    ctx.textBaseline = "top";
    ctx.fillText(`max ${maxCov}`, 4, 3);

    // ── Inferred exon/intron track ────────────────────────────
    const exonMidY = exonY + EXON_H / 2;
    ctx.strokeStyle = COLORS.muted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, exonMidY);
    ctx.lineTo(W, exonMidY);
    ctx.stroke();

    ctx.fillStyle = COLORS.warning;
    let inExon = false,
      exonStart = 0;
    for (let b = 0; b <= W; b++) {
      const covered = b < W && bins[b] >= COV_THRESHOLD;
      if (!inExon && covered) {
        inExon = true;
        exonStart = b;
      } else if (inExon && !covered) {
        inExon = false;
        ctx.fillRect(exonStart, exonY, b - exonStart, EXON_H);
      }
    }

    // ── Annotated transcript rows ─────────────────────────────
    if (sortedTranscripts.length) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = "9px monospace";
      ctx.textBaseline = "top";
      ctx.fillText("Transcripts (Ensembl)", 3, txAreaY);

      const txStartY = txAreaY + TX_HEADER_H;
      const minus = geneInfo?.strand === -1;
      const toG = (cs, ce) =>
        minus
          ? [geneInfo.end - ce, geneInfo.end - cs + 1]
          : [cs - geneInfo.start, ce - geneInfo.start + 1];

      for (let ti = 0; ti < sortedTranscripts.length; ti++) {
        const t = sortedTranscripts[ti];
        const rowY = txStartY + ti * (TX_ROW_H + TX_ROW_GAP);
        const midY = rowY + TX_ROW_H / 2;
        const colors = txColors(t, txEvidence);

        const [tGS_r, tGE_r] = toG(t.start, t.end);
        const tGS = Math.max(0, tGS_r);
        const tGE = Math.min(geneLen, tGE_r);
        if (tGS >= geneLen || tGE <= 0) continue;

        const txX = Math.floor((tGS / geneLen) * W);
        const txX2 = Math.ceil((tGE / geneLen) * W);

        // Backbone
        ctx.strokeStyle = colors.backbone;
        ctx.lineWidth = colors.lw;
        ctx.beginPath();
        ctx.moveTo(txX, midY);
        ctx.lineTo(txX2, midY);
        ctx.stroke();

        // Exon rectangles — coloured by evidence tier
        for (const exon of t.exons) {
          const [eGS_r, eGE_r] = toG(exon.start, exon.end);
          const eGS = Math.max(0, eGS_r);
          const eGE = Math.min(geneLen, eGE_r);
          if (eGS >= geneLen || eGE <= 0) continue;

          const eX = Math.floor((eGS / geneLen) * W);
          const eX2 = Math.ceil((eGE / geneLen) * W);
          const eW = Math.max(2, eX2 - eX);

          const covered = regionCovered(eGS, eGE);
          ctx.fillStyle = covered ? colors.exonCovered : colors.exonUncovered;
          ctx.fillRect(eX, rowY, eW, TX_ROW_H);
        }
      }
    }

    // ── Window highlight (full height, excluding gene bar) ────
    if (Number.isFinite(windowStart) && windowSize > 0) {
      const winX = Math.floor((windowStart / geneLen) * W);
      const winW = Math.max(2, Math.floor((windowSize / geneLen) * W));
      ctx.fillStyle = "rgba(255,180,0,0.22)";
      ctx.fillRect(winX, 0, winW, geneBarY);
      ctx.strokeStyle = "rgba(200,120,0,0.65)";
      ctx.lineWidth = 1;
      ctx.strokeRect(winX + 0.5, 0.5, winW - 1, geneBarY - 1);
    }
  }, [
    coverageArray,
    canvasWidth,
    geneSequence,
    windowStart,
    windowSize,
    geneInfo,
    sortedTranscripts,
    txEvidence,
    H,
  ]);

  const handleClick = (e) => {
    if (!geneSequence?.length || !onWindowJump) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const genePos = Math.floor(frac * geneSequence.length);
    onWindowJump(
      Math.max(
        0,
        Math.min(
          geneSequence.length - windowSize,
          genePos - Math.floor(windowSize / 2),
        ),
      ),
    );
  };

  const handleMouseMove = (e) => {
    if (!sortedTranscripts.length) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const exonY = COV_H + GAP;
    const txAreaY = exonY + EXON_H + GAP;
    const txStartY = txAreaY + TX_HEADER_H;
    const idx = Math.floor((mouseY - txStartY) / (TX_ROW_H + TX_ROW_GAP));
    if (idx >= 0 && idx < sortedTranscripts.length) {
      setHoveredTx({
        tx: sortedTranscripts[idx],
        clientX: e.clientX,
        clientY: e.clientY,
        idx,
      });
    } else {
      setHoveredTx(null);
    }
  };

  const handleMouseLeave = () => setHoveredTx(null);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 4,
        overflow: "hidden",
        marginBottom: "0.75rem",
      }}
    >
      {/* Canvas — clickable to jump pileup window */}
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: H,
          cursor: "crosshair",
        }}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />

      {/* Transcript hover tooltip */}
      {hoveredTx &&
        (() => {
          const ev = txEvidence?.get(hoveredTx.tx.id);
          const evText = ev
            ? `Evidence: ${Math.round(ev.fraction * 100)}% (${ev.count} spliced reads)`
            : txEvidence
              ? "No spliced evidence"
              : "";
          return (
            <div
              style={{
                position: "fixed",
                left: hoveredTx.clientX + 12,
                top: hoveredTx.clientY - 8,
                background: "#fff",
                border: "1px solid #bbb",
                borderRadius: 4,
                padding: "4px 8px",
                fontSize: 11,
                fontFamily: '"Courier New", Courier, monospace',
                pointerEvents: "none",
                zIndex: 9999,
                boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: hoveredTx.tx.isCanonical ? COLORS.accent : COLORS.text,
                }}
              >
                {hoveredTx.tx.isCanonical ? "* " : ""}
                {hoveredTx.tx.id}
              </span>
              <span style={{ color: COLORS.muted, marginLeft: 6 }}>
                {hoveredTx.tx.biotype}
                {hoveredTx.tx.isCanonical ? " • canonical" : ""}
              </span>
              {evText && (
                <span style={{ color: COLORS.accent, marginLeft: 8 }}>
                  {evText}
                </span>
              )}
            </div>
          );
        })()}

      {/* Controls + legend */}
      <div
        style={{
          borderTop: `1px solid ${COLORS.border}`,
          padding: "3px 6px",
          display: "flex",
          alignItems: "flex-start",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        {sortedTranscripts.length > 0 && (
          <>
            <button
              onClick={() => setShowZoom(true)}
              style={{
                fontSize: "11px",
                padding: "1px 8px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Zoom
            </button>
            <span
              style={{
                fontSize: 10,
                color: COLORS.muted,
                fontFamily: "monospace",
              }}
            >
              {sortedTranscripts.length} transcript
              {sortedTranscripts.length !== 1 ? "s" : ""} — hover to identify
            </span>
          </>
        )}
        {onExportPdf && (
          <button
            onClick={onExportPdf}
            disabled={isPdfExporting}
            style={{
              fontSize: "11px",
              padding: "1px 8px",
              cursor: "pointer",
              whiteSpace: "nowrap",
              marginLeft: "auto",
            }}
          >
            {isPdfExporting ? "Generating…" : "Export PDF"}
          </button>
        )}
      </div>

      {showZoom && (
        <TranscriptZoomModal
          transcripts={sortedTranscripts}
          geneInfo={geneInfo}
          geneSequence={geneSequence}
          coverageArray={coverageArray}
          onClose={() => setShowZoom(false)}
        />
      )}
    </div>
  );
});

export default CoverageOverview;
