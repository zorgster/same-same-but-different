import { useRef, useEffect, useState } from "react";
import * as Styles from "../styles/fastq-gene-finder-styles.jsx";
import { COLORS } from "../../styles/light-theme";

const BASES_PER_PX = 10;
const MINI_H       = 30;
const COV_H        = 40;
const GAP          = 3;
const TX_ROW_H     = 12;
const TX_ROW_GAP   = 2;
const GENE_H       = 10;
const EXON_COV_MIN = 0.1;

function mainCanvasH(numTx) {
  return COV_H + GAP + numTx * (TX_ROW_H + TX_ROW_GAP) + GAP + GENE_H;
}

export default function TranscriptZoomModal({
  transcripts,
  geneInfo,
  geneSequence,
  coverageArray,
  onClose,
}) {
  const sizeRef  = useRef(null);
  const miniRef  = useRef(null);
  const mainRef  = useRef(null);
  const hitRef   = useRef([]);

  const [canvasWidth, setCanvasWidth] = useState(900);
  const [zoomStart,   setZoomStart]   = useState(0);
  const [tooltip,     setTooltip]     = useState(null);

  const geneLen     = geneSequence?.length ?? 0;
  const windowBases = canvasWidth * BASES_PER_PX;
  const numTx       = transcripts?.length ?? 0;
  const mainH       = mainCanvasH(numTx);
  const maxStart    = Math.max(0, geneLen - windowBases);
  const clamp       = (v) => Math.max(0, Math.min(maxStart, v));

  // Resize observer on canvas wrapper
  useEffect(() => {
    const el = sizeRef.current;
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

  // Keyboard navigation
  useEffect(() => {
    const half = Math.floor(windowBases / 2);
    const doClamp = (v) => Math.max(0, Math.min(Math.max(0, geneLen - windowBases), v));
    const onKey = (e) => {
      if (e.key === "Escape")      { onClose(); return; }
      if (e.key === "ArrowRight")  setZoomStart((s) => doClamp(s + half));
      if (e.key === "ArrowLeft")   setZoomStart((s) => doClamp(s - half));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, windowBases, geneLen]);

  // ── Draw minimap ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = miniRef.current;
    if (!canvas || !geneLen) return;
    const W = canvasWidth;
    canvas.width  = W;
    canvas.height = MINI_H;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, MINI_H);

    if (coverageArray) {
      const bins = new Float32Array(W);
      for (let b = 0; b < W; b++) {
        const gs = Math.floor((b / W) * geneLen);
        const ge = Math.max(gs + 1, Math.floor(((b + 1) / W) * geneLen));
        let sum = 0;
        for (let i = gs; i < ge && i < geneLen; i++) sum += coverageArray[i];
        bins[b] = sum / (ge - gs);
      }
      const maxCov = Math.max(...bins, 1);

      ctx.beginPath();
      ctx.moveTo(0, MINI_H);
      for (let b = 0; b < W; b++) ctx.lineTo(b, MINI_H - (bins[b] / maxCov) * (MINI_H - 4));
      ctx.lineTo(W, MINI_H);
      ctx.closePath();
      ctx.fillStyle = COLORS.accent + "30";
      ctx.fill();

      ctx.beginPath();
      for (let b = 0; b < W; b++) {
        const y = MINI_H - (bins[b] / maxCov) * (MINI_H - 4);
        b === 0 ? ctx.moveTo(b, y) : ctx.lineTo(b, y);
      }
      ctx.strokeStyle = COLORS.accent;
      ctx.lineWidth   = 1;
      ctx.stroke();
    }

    const winX = Math.floor((zoomStart / geneLen) * W);
    const winW = Math.max(2, Math.floor((windowBases / geneLen) * W));
    ctx.fillStyle   = "rgba(255,180,0,0.28)";
    ctx.fillRect(winX, 0, winW, MINI_H);
    ctx.strokeStyle = "rgba(200,120,0,0.75)";
    ctx.lineWidth   = 1;
    ctx.strokeRect(winX + 0.5, 0.5, winW - 1, MINI_H - 1);
  }, [canvasWidth, geneLen, coverageArray, zoomStart, windowBases]);

  // ── Draw main canvas ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = mainRef.current;
    if (!canvas || !geneLen) return;
    const W = canvasWidth;
    canvas.width  = W;
    canvas.height = mainH;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, mainH);
    hitRef.current = [];

    const zEnd    = Math.min(geneLen, zoomStart + windowBases);
    const viewLen = Math.max(1, zEnd - zoomStart);

    // ── Gene bar ──────────────────────────────────────────────────────────
    const geneBarY = mainH - GENE_H;
    ctx.fillStyle = COLORS.border;
    ctx.fillRect(0, geneBarY, W, GENE_H);
    ctx.fillStyle    = COLORS.muted;
    ctx.font         = "9px monospace";
    ctx.textBaseline = "middle";
    const barMidY = geneBarY + GENE_H / 2;
    if (geneInfo) {
      const m = geneInfo.strand === -1;
      const c1 = m ? geneInfo.end - zoomStart : geneInfo.start + zoomStart;
      const c2 = m ? geneInfo.end - zEnd      : geneInfo.start + zEnd;
      const lbl = `${geneInfo.seqRegionName}:${(m ? c2 : c1).toLocaleString()}`;
      const rbl = (m ? c1 : c2).toLocaleString();
      ctx.fillText(lbl, 3, barMidY);
      ctx.fillText(rbl, W - ctx.measureText(rbl).width - 3, barMidY);
    } else {
      ctx.fillText(zoomStart.toLocaleString(), 3, barMidY);
      const rbl = zEnd.toLocaleString();
      ctx.fillText(rbl, W - ctx.measureText(rbl).width - 3, barMidY);
    }

    if (!coverageArray) return;

    // ── Coverage sparkline ────────────────────────────────────────────────
    const bins = new Float32Array(W);
    for (let b = 0; b < W; b++) {
      const gs = Math.floor(zoomStart + (b / W) * viewLen);
      const ge = Math.max(gs + 1, Math.floor(zoomStart + ((b + 1) / W) * viewLen));
      let sum = 0;
      for (let i = gs; i < ge && i < geneLen; i++) sum += coverageArray[i];
      bins[b] = sum / (ge - gs);
    }
    const maxCov = Math.max(...bins, 1);

    ctx.beginPath();
    ctx.moveTo(0, COV_H);
    for (let b = 0; b < W; b++) ctx.lineTo(b, COV_H - (bins[b] / maxCov) * (COV_H - 6));
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
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    ctx.fillStyle    = COLORS.muted;
    ctx.font         = "9px monospace";
    ctx.textBaseline = "top";
    ctx.fillText(`max ${Math.round(maxCov)}`, 4, 3);

    if (!transcripts?.length || !geneInfo) return;

    // ── Transcript rows ───────────────────────────────────────────────────
    const toX   = (gPos) => Math.round(((gPos - zoomStart) / viewLen) * W);
    const minus = geneInfo.strand === -1;
    const toG   = (cs, ce) => minus
      ? [geneInfo.end - ce, geneInfo.end - cs + 1]
      : [cs - geneInfo.start, ce - geneInfo.start + 1];
    const txStartY = COV_H + GAP;

    for (let ti = 0; ti < transcripts.length; ti++) {
      const t    = transcripts[ti];
      const rowY = txStartY + ti * (TX_ROW_H + TX_ROW_GAP);
      const midY = rowY + TX_ROW_H / 2;

      const [tGS_r, tGE_r] = toG(t.start, t.end);
      const tGS = Math.max(0, tGS_r);
      const tGE = Math.min(geneLen, tGE_r);
      if (tGS >= geneLen || tGE <= 0) continue;

      const txX  = toX(tGS);
      const txX2 = toX(tGE);
      if (txX2 <= 0 || txX >= W) continue;

      // Backbone
      ctx.strokeStyle = t.isCanonical ? COLORS.accent : COLORS.border;
      ctx.lineWidth   = t.isCanonical ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.max(0, txX), midY);
      ctx.lineTo(Math.min(W, txX2), midY);
      ctx.stroke();

      // Label (last 6 chars of ENST ID) at left edge of backbone
      const labelX = Math.max(2, txX) + 1;
      ctx.fillStyle    = t.isCanonical ? COLORS.accent : COLORS.muted;
      ctx.font         = "8px monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(t.id.slice(-6), labelX, midY);

      // Exon rectangles
      for (const exon of t.exons) {
        const [eGS_r, eGE_r] = toG(exon.start, exon.end);
        const eGS = Math.max(0, eGS_r);
        const eGE = Math.min(geneLen, eGE_r);
        if (eGS >= geneLen || eGE <= 0) continue;

        const eX  = toX(eGS);
        const eX2 = toX(eGE);
        if (eX2 <= 0 || eX >= W) continue;

        const cx  = Math.max(0, eX);
        const cx2 = Math.min(W, eX2);
        const eW  = Math.max(2, cx2 - cx);

        const covS = Math.max(0, eGS);
        const covE = Math.min(coverageArray.length, eGE);
        let covered = false;
        if (covE > covS) {
          let sum = 0;
          for (let i = covS; i < covE; i++) sum += coverageArray[i];
          covered = sum / (covE - covS) >= EXON_COV_MIN;
        }

        ctx.fillStyle = covered
          ? (t.isCanonical ? COLORS.accent : COLORS.success)
          : (COLORS.muted + "55");
        ctx.fillRect(cx, rowY, eW, TX_ROW_H);

        hitRef.current.push({ x1: cx, y1: rowY, x2: cx + eW, y2: rowY + TX_ROW_H, t, exon, eGS, eGE, covered });
      }
    }
  }, [canvasWidth, geneLen, coverageArray, zoomStart, windowBases, transcripts, geneInfo, mainH]);

  // ── Minimap click ─────────────────────────────────────────────────────────
  const handleMiniClick = (e) => {
    if (!geneLen) return;
    const rect = miniRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    setZoomStart(clamp(Math.floor(frac * geneLen) - Math.floor(windowBases / 2)));
  };

  // ── Tooltip on main canvas ────────────────────────────────────────────────
  const handleMouseMove = (e) => {
    const rect = mainRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const hit = hitRef.current.find((h) => mx >= h.x1 && mx <= h.x2 && my >= h.y1 && my <= h.y2);
    if (!hit) { setTooltip(null); return; }

    const { t, exon, eGS, eGE, covered } = hit;
    const lines = [
      `${t.id}${t.isCanonical ? " ★" : ""}${t.biotype !== "protein_coding" ? ` (${t.biotype})` : ""}`,
      `Exon: ${exon.id}`,
      `Gene pos: ${eGS.toLocaleString()}–${eGE.toLocaleString()}`,
      geneInfo
        ? `${geneInfo.seqRegionName}: ${(geneInfo.start + eGS).toLocaleString()}–${(geneInfo.start + eGE).toLocaleString()}`
        : null,
      `Length: ${(eGE - eGS).toLocaleString()} bp`,
      covered ? "✓ Covered by reads" : "— Not covered",
    ].filter(Boolean);

    setTooltip({ x: e.clientX + 14, y: e.clientY + 10, lines });
  };

  const handleMouseLeave = () => setTooltip(null);

  // ── Nav ───────────────────────────────────────────────────────────────────
  const half = Math.floor(windowBases / 2);
  const zEnd = Math.min(geneLen, zoomStart + windowBases);

  return (
    <div style={Styles.modalOverlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          ...Styles.modalCard,
          width: "min(1400px, calc(100% - 2rem))",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          padding: "0.6rem 0.75rem",
          gap: 5,
          overflowY: "hidden",
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
          <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>Transcript Zoom</span>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.muted }}>
            1 px = {BASES_PER_PX} bp &nbsp;·&nbsp; {windowBases.toLocaleString()} bp visible &nbsp;·&nbsp;
            pos {zoomStart.toLocaleString()}–{zEnd.toLocaleString()}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 3, alignItems: "center" }}>
            <button onClick={() => setZoomStart(0)}               title="Gene start"        style={{ fontSize: 12, padding: "1px 6px", cursor: "pointer", fontFamily: "monospace" }}>⟨⟨</button>
            <button onClick={() => setZoomStart(clamp(zoomStart - half))} title="Back half window"    style={{ fontSize: 12, padding: "1px 6px", cursor: "pointer", fontFamily: "monospace" }}>⟨</button>
            <button onClick={() => setZoomStart(clamp(zoomStart + half))} title="Forward half window" style={{ fontSize: 12, padding: "1px 6px", cursor: "pointer", fontFamily: "monospace" }}>⟩</button>
            <button onClick={() => setZoomStart(clamp(geneLen))}  title="Gene end"          style={{ fontSize: 12, padding: "1px 6px", cursor: "pointer", fontFamily: "monospace" }}>⟩⟩</button>
            <button onClick={onClose} title="Close (Esc)" style={{ ...Styles.modalCloseButton, position: "static", marginLeft: 6 }}>×</button>
          </div>
        </div>

        {/* Canvas wrapper — ResizeObserver target */}
        <div ref={sizeRef} style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minHeight: 0 }}>
          {/* Minimap */}
          <canvas
            ref={miniRef}
            style={{ display: "block", width: "100%", height: MINI_H, cursor: "crosshair", border: `1px solid ${COLORS.border}`, borderRadius: 2, flexShrink: 0 }}
            onClick={handleMiniClick}
            title="Click to jump to position"
          />

          {/* Main transcript canvas — scrollable */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            <canvas
              ref={mainRef}
              style={{ display: "block", width: "100%", height: mainH, cursor: "default" }}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />
          </div>
        </div>

        <div style={{ fontSize: 10, color: COLORS.muted, fontFamily: "monospace", flexShrink: 0 }}>
          ← → arrow keys · click minimap to jump · Esc to close
        </div>
      </div>

      {tooltip && (
        <div
          style={{
            position: "fixed",
            left: tooltip.x,
            top: tooltip.y,
            background: "#1a1a2e",
            color: "#e8e8f0",
            border: "1px solid #556",
            borderRadius: 4,
            padding: "5px 9px",
            fontSize: 11,
            fontFamily: "monospace",
            lineHeight: 1.65,
            pointerEvents: "none",
            zIndex: 2000,
            whiteSpace: "nowrap",
          }}
        >
          {tooltip.lines.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
    </div>
  );
}
