import { useRef, useEffect, useMemo, useState } from "react";
import { COLORS } from "../../styles/light-theme";
import TranscriptZoomModal from "./TranscriptZoomModal.jsx";

// ── Layout constants ────────────────────────────────────────────────────────
const COV_H             = 68;
const EXON_H            = 14;  // inferred exon/intron track from reads
const GENE_H            = 10;  // chromosome coordinate bar
const GAP               = 3;
const TX_HEADER_H       = 13;  // "Transcripts" section label
const TX_ROW_H          = 10;
const TX_ROW_GAP        = 2;

const COV_THRESHOLD     = 0.3;  // binned reads/bp to call a region covered (inferred track)
const EXON_COV_MIN      = 0.1;  // reads/bp in coverageArray to colour an annotated exon

function canvasH(numTranscripts) {
  const txArea = numTranscripts > 0
    ? GAP + TX_HEADER_H + numTranscripts * (TX_ROW_H + TX_ROW_GAP)
    : 0;
  return COV_H + GAP + EXON_H + txArea + GAP + GENE_H;
}

// ── Transcript fetch ────────────────────────────────────────────────────────
async function loadTranscripts(geneId) {
  const res = await fetch(
    `https://rest.ensembl.org/lookup/id/${encodeURIComponent(geneId)}?content-type=application/json&expand=1`,
  );
  if (!res.ok) throw new Error(`Ensembl lookup failed (${res.status})`);
  const json = await res.json();

  const raw = Array.isArray(json.Transcript) ? json.Transcript : [];
  const sorted = [...raw].sort((a, b) => {
    if ((b.is_canonical ?? 0) !== (a.is_canonical ?? 0)) return (b.is_canonical ?? 0) - (a.is_canonical ?? 0);
    if ((a.biotype === "protein_coding") !== (b.biotype === "protein_coding"))
      return a.biotype === "protein_coding" ? -1 : 1;
    return (a.id || "").localeCompare(b.id || "");
  });

  return sorted.slice(0, 30).map((t) => ({
    id: t.id,
    biotype: t.biotype || "",
    isCanonical: t.is_canonical === 1,
    start: t.start,
    end: t.end,
    exons: (Array.isArray(t.Exon) ? t.Exon : []).map((e) => ({
      id: e.id,
      start: e.start,
      end: e.end,
    })),
  }));
}

// ── Component ───────────────────────────────────────────────────────────────
export default function CoverageOverview({
  geneSequence,
  matchingReads,
  readLength = 100,
  windowStart,
  windowSize,
  onWindowJump,
  geneInfo,
}) {
  const containerRef = useRef(null);
  const canvasRef    = useRef(null);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const [transcripts, setTranscripts] = useState(null);  // null = not loaded
  const [txLoading,   setTxLoading]   = useState(false);
  const [txError,     setTxError]     = useState(null);
  const [showZoom,    setShowZoom]    = useState(false);

  // Reset transcripts when gene changes
  useEffect(() => {
    setTranscripts(null);
    setTxError(null);
  }, [geneInfo?.id]);

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

  const handleLoadTranscripts = async () => {
    if (!geneInfo?.id) return;
    setTxLoading(true);
    setTxError(null);
    try {
      setTranscripts(await loadTranscripts(geneInfo.id));
    } catch (e) {
      setTxError(e.message);
    }
    setTxLoading(false);
  };

  // Per-position coverage via difference array
  const coverageArray = useMemo(() => {
    const geneLen = geneSequence?.length;
    if (!geneLen || !matchingReads.length) return null;
    const diff = new Int32Array(geneLen + 1);
    for (const read of matchingReads) {
      const pos = read.position ?? read.positions?.[0];
      if (pos == null || !Number.isFinite(pos) || pos < 0 || pos >= geneLen) continue;
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
  const numTx = transcripts?.length ?? 0;
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
    const exonY    = COV_H + GAP;
    const txAreaY  = exonY + EXON_H + GAP;
    const geneBarY = numTx > 0
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
    let inExon = false, exonStart = 0;
    for (let b = 0; b <= W; b++) {
      const covered = b < W && bins[b] >= COV_THRESHOLD;
      if (!inExon && covered)  { inExon = true;  exonStart = b; }
      else if (inExon && !covered) { inExon = false; ctx.fillRect(exonStart, exonY, b - exonStart, EXON_H); }
    }

    // ── Annotated transcript rows ─────────────────────────────
    if (transcripts?.length) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = "9px monospace";
      ctx.textBaseline = "top";
      ctx.fillText("Transcripts (Ensembl)", 3, txAreaY);

      const txStartY = txAreaY + TX_HEADER_H;

      for (let ti = 0; ti < transcripts.length; ti++) {
        const t = transcripts[ti];
        const rowY   = txStartY + ti * (TX_ROW_H + TX_ROW_GAP);
        const midY   = rowY + TX_ROW_H / 2;

        const minus = geneInfo.strand === -1;
        const toG = (cs, ce) => minus
          ? [geneInfo.end - ce, geneInfo.end - cs + 1]
          : [cs - geneInfo.start, ce - geneInfo.start + 1];

        const [tGS_r, tGE_r] = toG(t.start, t.end);
        const tGS = Math.max(0, tGS_r);
        const tGE = Math.min(geneLen, tGE_r);
        if (tGS >= geneLen || tGE <= 0) continue;

        const txX  = Math.floor((tGS / geneLen) * W);
        const txX2 = Math.ceil((tGE / geneLen) * W);

        // Backbone
        ctx.strokeStyle = t.isCanonical ? COLORS.accent : COLORS.border;
        ctx.lineWidth = t.isCanonical ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(txX, midY);
        ctx.lineTo(txX2, midY);
        ctx.stroke();

        // Exon rectangles — coloured if covered
        for (const exon of t.exons) {
          const [eGS_r, eGE_r] = toG(exon.start, exon.end);
          const eGS = Math.max(0, eGS_r);
          const eGE = Math.min(geneLen, eGE_r);
          if (eGS >= geneLen || eGE <= 0) continue;

          const eX  = Math.floor((eGS / geneLen) * W);
          const eX2 = Math.ceil((eGE / geneLen) * W);
          const eW  = Math.max(2, eX2 - eX);

          const covered = regionCovered(eGS, eGE);
          ctx.fillStyle = covered
            ? (t.isCanonical ? COLORS.accent : COLORS.success)
            : (COLORS.muted + "55");
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
  }, [coverageArray, canvasWidth, geneSequence, windowStart, windowSize, geneInfo, transcripts, H]);

  const handleClick = (e) => {
    if (!geneSequence?.length || !onWindowJump) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const genePos = Math.floor(frac * geneSequence.length);
    onWindowJump(Math.max(0, Math.min(
      geneSequence.length - windowSize,
      genePos - Math.floor(windowSize / 2),
    )));
  };

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", border: `1px solid ${COLORS.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "0.75rem" }}
    >
      {/* Canvas — clickable to jump pileup window */}
      <canvas
        ref={canvasRef}
        style={{ display: "block", width: "100%", height: H, cursor: "crosshair" }}
        onClick={handleClick}
        title="Click to jump pileup to this position"
      />

      {/* Transcript controls + legend */}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: "3px 6px", display: "flex", alignItems: "flex-start", gap: "0.75rem", flexWrap: "wrap" }}>
        {geneInfo?.id && transcripts === null && (
          <button
            onClick={handleLoadTranscripts}
            disabled={txLoading}
            style={{ fontSize: "11px", padding: "1px 8px", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            {txLoading ? "Loading…" : "Load Transcripts"}
          </button>
        )}
        {txError && (
          <span style={{ fontSize: 10, color: COLORS.error }}>{txError}</span>
        )}
        {transcripts?.length > 0 && (
          <>
            <button
              onClick={() => setShowZoom(true)}
              style={{ fontSize: "11px", padding: "1px 8px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Zoom
            </button>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", fontSize: 9, fontFamily: "monospace", lineHeight: 1.8 }}>
              {transcripts.map((t) => (
                <span key={t.id} style={{ color: t.isCanonical ? COLORS.accent : COLORS.muted }}>
                  {t.isCanonical ? "★ " : ""}{t.id}
                  {t.biotype !== "protein_coding" ? ` (${t.biotype})` : ""}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {showZoom && (
        <TranscriptZoomModal
          transcripts={transcripts}
          geneInfo={geneInfo}
          geneSequence={geneSequence}
          coverageArray={coverageArray}
          onClose={() => setShowZoom(false)}
        />
      )}
    </div>
  );
}
