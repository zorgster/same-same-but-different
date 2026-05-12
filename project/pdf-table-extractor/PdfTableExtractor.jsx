import { useState, useCallback, useEffect, useRef } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { ChevronLeft, ChevronRight } from "lucide-react";
import DropZone from "../widgets/DropZone";
import ColumnEditor from "./ColumnEditor";
import { bakePage, detectDataRect, shimmyMarkers, shimmyDataRect, detectRowAtY } from "./pageAnalysis";
import { ocrPage, terminateOcrWorker } from "./ocrUtils";
import { COLORS, MONO_FONT } from "../styles/light-theme";
import S from "./styles";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).href;

const RENDER_SCALE = 1.5; // canvas resolution for rendered page images

// ── Projection-profile deskew: finds the sub-degree rotation that maximises
// row-sum variance (text lines become sharp horizontal bands when level). ─────
function deskewPage(dataUrl, currentRot) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const SIZE  = 350;
      const scale = Math.min(SIZE / img.width, SIZE / img.height);
      const iw    = img.width  * scale;
      const ih    = img.height * scale;

      let bestVariance = -1;
      let bestDelta    = 0;

      for (let d = -3; d <= 3.01; d += 0.25) {
        const c   = document.createElement("canvas");
        c.width   = c.height = SIZE;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.save();
        ctx.translate(SIZE / 2, SIZE / 2);
        ctx.rotate(((currentRot + d) * Math.PI) / 180);
        ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
        ctx.restore();

        // Use only the left 75% of each row — the rightmost quarter typically
        // contains handwritten signatures that span row boundaries and flatten
        // the variance signal regardless of rotation angle.
        const useW = Math.round(SIZE * 0.75);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        const sums = new Float32Array(SIZE);
        let mean = 0;
        for (let y = 0; y < SIZE; y++) {
          let s = 0;
          for (let x = 0; x < useW; x++) {
            const p = (y * SIZE + x) * 4;
            s += 255 - (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
          }
          sums[y] = s;
          mean   += s;
        }
        mean /= SIZE;
        let variance = 0;
        for (let y = 0; y < SIZE; y++) variance += (sums[y] - mean) ** 2;

        if (variance > bestVariance) { bestVariance = variance; bestDelta = d; }
      }

      resolve(Math.round(bestDelta * 100) / 100);
    };
    img.src = dataUrl;
  });
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function PDFTableExtractor() {
  const [file, setFile]           = useState(null);
  const [pages, setPages]         = useState([]); // [{ dataUrl, pdfRotation, w, h }]
  const [rotations, setRotations] = useState([]); // user fine-tune per page (degrees)
  const [current, setCurrent]     = useState(0);
  const [status, setStatus]       = useState("idle"); // idle | loading | done | error
  const [progress, setProgress]   = useState({ cur: 0, total: 0 });
  const [error, setError]         = useState("");
  const [deskewing, setDeskewing]           = useState(false);
  const [deskewProgress, setDeskewProgress] = useState(null); // null | { cur, total }
  const [thumbUrls, setThumbUrls]           = useState([]);   // pre-rendered rotated thumbnails
  const [defineMode, setDefineMode] = useState(false);
  const [defineTool, setDefineTool] = useState("none"); // rect-data | rect-meta | rect-header | none
  const [editSnapshot, setEditSnapshot] = useState(null);
  const [cropConfirm, setCropConfirm]   = useState(false);
  const [ocrResults, setOcrResults]     = useState(null);   // null | { pages: [...] }
  const [ocrProgress, setOcrProgress]   = useState(null);   // null | { cur, total, pagePct }
  const [colTypes, setColTypes]         = useState([]);     // "text"|"tick" per column
  // Per-page column definitions — everything lives here
  const [pageDefs, setPageDefs] = useState([]);
  // pageDefs[i] = { colMarkers[], dataRect, metaRect, headerRect, hasMetaRow, hasHeaderRow }

  // ── Load PDF and render every page to a JPEG data URL ──────────────────────
  const processFile = useCallback(async (f) => {
    if (!f || f.type !== "application/pdf") {
      setError("Please upload a PDF file.");
      return;
    }
    setFile(f);
    setError("");
    setPages([]);
    setRotations([]);
    setCurrent(0);
    setOcrResults(null);
    setOcrProgress(null);
    setColTypes([]);
    setStatus("loading");

    try {
      const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
      const total = pdf.numPages;
      setProgress({ cur: 0, total });

      const rendered = [];
      for (let i = 1; i <= total; i++) {
        const page = await pdf.getPage(i);
        // The viewport applies any rotation stored in the PDF metadata so the
        // rendered image is already upright from pdfjs's perspective.
        const vp = page.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width  = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
        rendered.push({
          dataUrl:     canvas.toDataURL("image/jpeg", 0.88),
          pdfRotation: page.rotate ?? 0,
          w:           canvas.width,
          h:           canvas.height,
        });
        setProgress({ cur: i, total });
      }

      setPages(rendered);
      setRotations(rendered.map(() => 0));
      setPageDefs(rendered.map(() => ({
        colMarkers: [], dataRect: null, metaRect: null, headerRect: null,
        hasMetaRow: false, hasHeaderRow: false,
      })));
      setStatus("done");
    } catch (e) {
      setError(e.message || "Failed to load PDF.");
      setStatus("error");
    }
  }, []);

  // ── Keep colTypes length in sync with column count (based on page 0) ─────────
  useEffect(() => {
    const numCols = (pageDefs[0]?.colMarkers?.length ?? 0) + 1;
    setColTypes(prev => {
      if (prev.length === numCols) return prev;
      return Array.from({ length: numCols }, (_, k) => prev[k] ?? 'text');
    });
  }, [pageDefs[0]?.colMarkers?.length]);  // eslint-disable-line

  // ── Arrow key navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowLeft")  setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(pages.length - 1, c + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length]);

  // ── Thumbnail strip auto-scroll ────────────────────────────────────────────
  const thumbRefs = useRef([]);
  useEffect(() => {
    thumbRefs.current[current]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);

  // ── Pre-render rotated thumbnails so CSS transform doesn't fight layout ────
  useEffect(() => {
    if (!pages.length) { setThumbUrls([]); return; }
    let alive = true;
    const TMAX = 100;
    Promise.all(
      pages.map((pg, i) =>
        new Promise((res) => {
          const img = new Image();
          img.onload = () => {
            // If the user hasn't rotated a landscape page yet, show it portrait
            // in the thumbnail so it's immediately recognisable.
            const userRot = rotations[i] ?? 0;
            const rot = (!pg.cropped && userRot === 0 && pg.w > pg.h) ? -90 : userRot;
            const rad = (rot * Math.PI) / 180;
            const cos = Math.abs(Math.cos(rad));
            const sin = Math.abs(Math.sin(rad));
            const bw  = pg.w * cos + pg.h * sin;
            const bh  = pg.w * sin + pg.h * cos;
            const s   = Math.min(TMAX / bw, TMAX / bh);
            const cw  = Math.round(bw * s);
            const ch  = Math.round(bh * s);
            const c   = document.createElement("canvas");
            c.width = cw; c.height = ch;
            const ctx = c.getContext("2d");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, cw, ch);
            ctx.save();
            ctx.translate(cw / 2, ch / 2);
            ctx.rotate(rad);
            ctx.drawImage(img, -(pg.w * s) / 2, -(pg.h * s) / 2, pg.w * s, pg.h * s);
            ctx.restore();
            res(c.toDataURL("image/jpeg", 0.7));
          };
          img.src = pg.dataUrl;
        })
      )
    ).then((urls) => { if (alive) setThumbUrls(urls); });
    return () => { alive = false; };
  }, [pages, rotations]);

  // ── Per-page rotation helpers ───────────────────────────────────────────────
  const bump       = (delta) => setRotations((prev) => prev.map((r, i) => (i === current ? r + delta : r)));
  const resetRot   = ()      => setRotations((prev) => prev.map((r, i) => (i === current ? 0      : r)));
  const applyToAll = ()      => setRotations((prev) => prev.map(() => prev[current]));

  const deskewCurrent = async () => {
    setDeskewing(true);
    setDeskewProgress(null);
    const delta = await deskewPage(pages[current].dataUrl, rotations[current]);
    setRotations((prev) => prev.map((r, i) => (i === current ? r + delta : r)));
    setDeskewing(false);
  };

  const deskewAll = async () => {
    setDeskewing(true);
    const snap = [...rotations]; // snapshot so each page uses its own current rot
    setDeskewProgress({ cur: 0, total: pages.length });
    const newRots = [...snap];
    for (let i = 0; i < pages.length; i++) {
      const delta = await deskewPage(pages[i].dataUrl, snap[i]);
      newRots[i] = snap[i] + delta;
      setDeskewProgress({ cur: i + 1, total: pages.length });
    }
    setRotations(newRots);
    setDeskewing(false);
    setDeskewProgress(null);
  };

  // ── pageDefs helpers ────────────────────────────────────────────────────────
  const updatePageDef = (idx, patch) =>
    setPageDefs(prev => prev.map((d, i) => {
      if (i !== idx) return d;
      const next = { ...d, ...patch };
      next.hasMetaRow   = !!next.metaRect;
      next.hasHeaderRow = !!next.headerRect;
      return next;
    }));

  const enterEdit = (startTool = "none") => {
    setEditSnapshot(pageDefs.map(d => ({ ...d })));
    setDefineMode(true);
    setDefineTool(startTool);
  };

  const cancelEdit = () => {
    if (editSnapshot) setPageDefs(editSnapshot);
    setEditSnapshot(null);
    setDefineMode(false);
    setDefineTool("none");
  };

  const saveEdit = () => {
    setEditSnapshot(null);
    setDefineMode(false);
    setDefineTool("none");
  };

  // Shimmy each page's column markers + data-rect top/bottom
  const shimmyAll = async () => {
    const next = [...pageDefs];
    for (let i = 0; i < pages.length; i++) {
      if (!next[i].dataRect) continue;
      const c = await bakePage(pages[i].dataUrl, pages[i].w, pages[i].h, rotations[i]);
      if (next[i].colMarkers.length) {
        next[i] = { ...next[i], colMarkers: shimmyMarkers(c, next[i].colMarkers) };
      }
      const stopRects = [next[i].metaRect, next[i].headerRect].filter(Boolean);
      next[i] = { ...next[i], dataRect: shimmyDataRect(c, next[i].dataRect, stopRects) };
    }
    setPageDefs(next);
  };

  const handleMetaRowClick = async (yFrac) => {
    const def = pageDefs[current];
    if (!def?.dataRect) return;
    const c   = await bakePage(pages[current].dataUrl, pages[current].w, pages[current].h, rotations[current]);
    const row = detectRowAtY(c, def.dataRect, yFrac);
    if (!row) return;
    updatePageDef(current, {
      metaRect: row,
      dataRect: { ...def.dataRect, y1: row.y2 },
    });
  };

  const handleHeaderRowClick = async (yFrac) => {
    const def = pageDefs[current];
    if (!def?.dataRect) return;
    const c   = await bakePage(pages[current].dataUrl, pages[current].w, pages[current].h, rotations[current]);
    const row = detectRowAtY(c, def.dataRect, yFrac);
    if (!row) return;
    updatePageDef(current, {
      headerRect: row,
      dataRect: { ...def.dataRect, y1: row.y2 },
    });
  };

  const cropPages = async () => {
    const nextPages = [...pages];
    const nextDefs  = [...pageDefs];
    const nextRots  = [...rotations];

    for (let i = 0; i < pages.length; i++) {
      const def = nextDefs[i];
      if (!def?.dataRect) continue;

      // Crop bounds = union of all defined rects for this page
      const rects = [def.dataRect, def.metaRect, def.headerRect].filter(Boolean);
      const cx1 = Math.min(...rects.map(r => r.x1));
      const cy1 = Math.min(...rects.map(r => r.y1));
      const cx2 = Math.max(...rects.map(r => r.x2));
      const cy2 = Math.max(...rects.map(r => r.y2));

      // Bake (applies any outstanding rotation), then crop
      const baked = await bakePage(pages[i].dataUrl, pages[i].w, pages[i].h, rotations[i]);
      const bx = Math.round(cx1 * baked.width);
      const by = Math.round(cy1 * baked.height);
      const bw = Math.max(1, Math.round((cx2 - cx1) * baked.width));
      const bh = Math.max(1, Math.round((cy2 - cy1) * baked.height));

      const out = document.createElement("canvas");
      out.width = bw; out.height = bh;
      out.getContext("2d").drawImage(baked, bx, by, bw, bh, 0, 0, bw, bh);

      // Remap all fractional coordinates to the new cropped space
      const remX = fx => (fx - cx1) / (cx2 - cx1);
      const remY = fy => (fy - cy1) / (cy2 - cy1);
      const remR = r  => r ? { x1: remX(r.x1), y1: remY(r.y1), x2: remX(r.x2), y2: remY(r.y2) } : null;

      nextPages[i] = { ...pages[i], dataUrl: out.toDataURL("image/jpeg", 0.92), w: bw, h: bh, cropped: true };
      nextDefs[i]  = {
        ...def,
        dataRect:   remR(def.dataRect),
        metaRect:   remR(def.metaRect),
        headerRect: remR(def.headerRect),
        colMarkers: (def.colMarkers ?? []).map(remX),
      };
      nextRots[i] = 0; // rotation is baked into the cropped image
    }

    setPages(nextPages);
    setPageDefs(nextDefs);
    setRotations(nextRots);
    setCropConfirm(false);
  };

  const autoDetectRects = async () => {
    const next     = [...pageDefs];
    const canvases = [];

    for (let i = 0; i < pages.length; i++) {
      const c = await bakePage(pages[i].dataUrl, pages[i].w, pages[i].h, rotations[i]);
      canvases.push(c);
      const detected = detectDataRect(c);
      if (detected) next[i] = { ...next[i], dataRect: detected };
    }

    // Columns are identical across all pages — normalise x-bounds to the median
    // so pages with a missed column or stray edge don't deviate from consensus.
    const rects = next.map(d => d.dataRect).filter(Boolean);
    if (rects.length > 1) {
      const med = arr => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];
      const medX1 = med(rects.map(r => r.x1));
      const medX2 = med(rects.map(r => r.x2));
      for (let i = 0; i < next.length; i++) {
        if (next[i].dataRect)
          next[i] = { ...next[i], dataRect: { ...next[i].dataRect, x1: medX1, x2: medX2 } };
      }
    }

    // Shimmy each page using the already-baked canvas
    for (let i = 0; i < pages.length; i++) {
      if (next[i].dataRect)
        next[i] = { ...next[i], dataRect: shimmyDataRect(canvases[i], next[i].dataRect, [next[i].metaRect, next[i].headerRect]) };
    }

    setPageDefs(next);
    setEditSnapshot(next.map(d => ({ ...d })));
    setDefineMode(true);
    setDefineTool("none");
  };

  const runOcr = async () => {
    setOcrResults(null);
    setOcrProgress({ cur: 0, total: pages.length, pagePct: 0 });
    const results = [];
    for (let i = 0; i < pages.length; i++) {
      const def = pageDefs[i];
      if (!def?.dataRect) { results.push(null); continue; }
      const canvas = await bakePage(pages[i].dataUrl, pages[i].w, pages[i].h, rotations[i]);
      const r = await ocrPage(canvas, def, colTypes, (pct) =>
        setOcrProgress({ cur: i, total: pages.length, pagePct: pct }));
      results.push(r);
      setOcrProgress({ cur: i + 1, total: pages.length, pagePct: 0 });
    }
    setOcrResults({ pages: results });
    setOcrProgress(null);
  };

  const exportCsv = () => {
    if (!ocrResults) return;
    // Use header row from first page that has one
    const firstWithHeader = ocrResults.pages.find(p => p?.headerRow);
    const headerRow = firstWithHeader?.headerRow;
    const numCols = ocrResults.pages.find(p => p)?.numCols ?? 1;

    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [];
    if (headerRow) lines.push(headerRow.map(esc).join(','));

    ocrResults.pages.forEach((p, i) => {
      if (!p) return;
      if (p.metaText) lines.push(esc(p.metaText) + ','.repeat(numCols - 1));
      p.rows.forEach(row => lines.push(row.map(esc).join(',')));
    });

    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = (file?.name ?? 'table').replace(/\.pdf$/i, '') + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const pg  = pages[current] ?? null;
  const rot = rotations[current] ?? 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={S.outer}>

      {/* ── LEFT PANEL ────────────────────────────────────────────────────── */}
      <div style={S.left}>
        <h1 style={S.h1}>PDF Table Extractor</h1>
        <p  style={S.sub}>LOCAL · BROWSER · NO DATA SENT EXTERNALLY</p>

        <DropZone
          onFilesSelected={(files) => processFile(files[0])}
          accept={{ "application/pdf": [".pdf"] }}
          label="Drop a PDF here, or click to browse"
          selectedFiles={file ? [file] : []}
          fileInfo={status === "done" ? [{ label: "Viewing", value: `page ${current + 1} of ${pages.length}` }] : []}
        />

        {error && <div style={S.error}>{error}</div>}

        {status === "done" && (
          <>
            <Section title="STEP 1 — ROTATION">
              <p style={S.hint}>Set page 1's rotation, then Rotate All.</p>
              <div style={S.rotRow}>
                <RotBtn label="−90°" onClick={() => bump(-90)} />
                <RotBtn label="−1°"  onClick={() => bump(-1)}  />
                <span style={S.rotVal}>{rot > 0 ? "+" : ""}{rot}°</span>
                <RotBtn label="+1°"  onClick={() => bump(1)}   />
                <RotBtn label="+90°" onClick={() => bump(90)}  />
              </div>
              <div style={S.actionRow}>
                <button style={S.resetBtn} onClick={resetRot}>Reset to 0°</button>
                <button style={S.deskewBtn} onClick={applyToAll} disabled={deskewing}>
                  Rotate All
                </button>
              </div>
            </Section>

            <Section title="STEP 2 — DESKEW">
              <p style={S.hint}>Auto-corrects sub-degree scan skew per page.</p>
              <div style={S.actionRow}>
                <button style={{ ...S.deskewBtn, opacity: deskewing ? 0.5 : 1 }}
                  onClick={deskewCurrent} disabled={deskewing}>
                  {deskewing && !deskewProgress ? "Deskewing…" : "Deskew this page"}
                </button>
                <button style={{ ...S.deskewBtn, opacity: deskewing ? 0.5 : 1 }}
                  onClick={deskewAll} disabled={deskewing}>
                  {deskewProgress
                    ? `${deskewProgress.cur} / ${deskewProgress.total}`
                    : "Deskew all"}
                </button>
              </div>
            </Section>

            <Section title="STEP 3A — AUTO-DETECT">
              <p style={S.hint}>Finds the table block on each page by whitespace analysis.</p>
              <button style={S.deskewBtn} onClick={autoDetectRects}>Detect all pages</button>
            </Section>

            <Section title="STEP 3B — COLUMNS">
              {!defineMode ? (
                <>
                  <p style={S.hint}>Define the table layout on page 1, then copy to all pages.</p>
                  <button style={S.deskewBtn}
                    onClick={() => enterEdit(pageDefs[current]?.dataRect ? "none" : "rect-data")}>
                    {pageDefs[current]?.dataRect ? "Edit this page" : "Define table"}
                  </button>
                  {pageDefs[current]?.colMarkers?.length > 0 && (
                    <Row label="Cols (this page)" value={String(pageDefs[current].colMarkers.length + 1)} />
                  )}
                  {pageDefs[0]?.dataRect && (
                    <button style={S.deskewBtn} onClick={shimmyAll}>Shimmy all</button>
                  )}
                </>
              ) : (
                <>
                  <p style={S.hint}>
                    {defineTool === "rect-data"      ? "Drag to draw the data region." :
                     defineTool === "meta-click"     ? "Click anywhere on the metadata row." :
                     defineTool === "header-click"   ? "Click anywhere on the column header row." :
                     "Click inside the data region to add column splits. Double-click a marker to remove it."}
                  </p>

                  <DefineRow
                    label="Data region"
                    drawActive={defineTool === "rect-data"}
                    onDraw={() => setDefineTool("rect-data")}
                  />
                  <DefineRow
                    label="Metadata"
                    clickActive={defineTool === "meta-click"}
                    onClickRow={() => setDefineTool("meta-click")}
                  />
                  <DefineRow
                    label="Col headers"
                    clickActive={defineTool === "header-click"}
                    onClickRow={() => setDefineTool("header-click")}
                  />


                  {pageDefs[current]?.dataRect && (
                    <Row label="Cols (this page)" value={String((pageDefs[current].colMarkers?.length ?? 0) + 1)} />
                  )}

                  {colTypes.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
                      {colTypes.map((t, k) => (
                        <button
                          key={k}
                          title={t === "tick" ? "Tick/attendance column — click to make text" : "Text column — click to make tick"}
                          style={{
                            padding: "2px 7px", fontSize: 10, fontFamily: MONO_FONT,
                            border: `1px solid ${t === "tick" ? "#1a5ea8" : COLORS.border}`,
                            borderRadius: 4, cursor: "pointer",
                            background: t === "tick" ? "rgba(26,94,168,0.1)" : COLORS.surface,
                            color: t === "tick" ? "#1a5ea8" : COLORS.muted,
                          }}
                          onClick={() => setColTypes(prev => prev.map((v, i) => i === k ? (v === "tick" ? "text" : "tick") : v))}
                        >
                          {k + 1} {t === "tick" ? "✓" : "abc"}
                        </button>
                      ))}
                    </div>
                  )}

                  <div style={S.actionRow}>
                    <button style={S.resetBtn} onClick={cancelEdit}>Cancel</button>
                    <button style={S.deskewBtn} onClick={saveEdit}>Save</button>
                  </div>
                </>
              )}
            </Section>

            <Section title="STEP 4 — CROP">
              {!pageDefs.some(d => d?.dataRect) ? (
                <p style={S.hint}>Complete Step 3 first.</p>
              ) : cropConfirm ? (
                <>
                  <p style={{ ...S.hint, color: COLORS.error }}>
                    Cannot be undone. Have you checked every page is correctly outlined?
                  </p>
                  <div style={S.actionRow}>
                    <button style={S.resetBtn} onClick={() => setCropConfirm(false)}>Cancel</button>
                    <button style={{ ...S.deskewBtn, background: COLORS.error, borderColor: COLORS.error, color: "#fff" }}
                      onClick={cropPages}>Confirm crop</button>
                  </div>
                </>
              ) : (
                <>
                  <p style={S.hint}>Crops each page to its table area. Cannot be undone.</p>
                  <button style={S.deskewBtn} onClick={() => setCropConfirm(true)}>Crop pages</button>
                </>
              )}
            </Section>

            <Section title="STEP 5 — OCR">
              {!pageDefs.some(d => d?.dataRect) ? (
                <p style={S.hint}>Complete Step 3 first.</p>
              ) : ocrProgress ? (
                <>
                  <p style={S.hint}>
                    Page {ocrProgress.cur + 1} / {ocrProgress.total}
                    {ocrProgress.pagePct > 0 ? ` — ${Math.round(ocrProgress.pagePct * 100)}%` : ""}
                  </p>
                  <div style={S.track}>
                    <div style={{
                      ...S.bar,
                      width: `${((ocrProgress.cur + ocrProgress.pagePct) / ocrProgress.total) * 100}%`,
                    }} />
                  </div>
                </>
              ) : ocrResults ? (
                <>
                  <p style={S.hint}>
                    {ocrResults.pages.filter(Boolean).reduce((n, p) => n + (p?.rows?.length ?? 0), 0)} data rows extracted.
                  </p>
                  <div style={S.actionRow}>
                    <button style={S.deskewBtn} onClick={runOcr}>Re-run OCR</button>
                    <button style={{ ...S.deskewBtn, ...S.deskewBtnActive }} onClick={exportCsv}>
                      Export CSV
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={S.hint}>
                    Recognises text in each defined table region. Language data (~10 MB) downloads once and is cached.
                  </p>
                  <button style={S.deskewBtn} onClick={runOcr}>Run OCR</button>
                </>
              )}
            </Section>
          </>
        )}
      </div>

      {/* ── THUMBNAIL STRIP ──────────────────────────────────────────────── */}
      <div style={S.thumbStrip}>
        {pages.map((pg, i) => (
          <div
            key={i}
            ref={(el) => (thumbRefs.current[i] = el)}
            onClick={() => setCurrent(i)}
            style={{ ...S.thumb, ...(i === current ? S.thumbActive : {}) }}
          >
            <img
              src={thumbUrls[i] ?? pg.dataUrl}
              alt={`Page ${i + 1}`}
              style={{ maxWidth: "100%", height: "auto", display: "block", borderRadius: 2 }}
            />
            <div style={S.thumbNum}>{i + 1}</div>
          </div>
        ))}
      </div>

      {/* ── RIGHT PANEL ───────────────────────────────────────────────────── */}
      <div style={S.right}>

        {status === "idle" && (
          <div style={S.placeholder}>
            <span style={{ color: COLORS.muted, fontSize: 13 }}>Upload a PDF to begin.</span>
          </div>
        )}

        {status === "loading" && (
          <div style={S.placeholder}>
            <span style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>
              Rendering page {progress.cur} of {progress.total}…
            </span>
            <div style={S.track}>
              <div style={{
                ...S.bar,
                width: `${progress.total ? (progress.cur / progress.total) * 100 : 0}%`,
              }} />
            </div>
          </div>
        )}

        {status === "done" && pg && (
          <>
            {/* Navigation bar */}
            <div style={S.navBar}>
              <NavBtn onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
                <ChevronLeft size={16} />
              </NavBtn>
              <span style={S.navLabel}>Page {current + 1} / {pages.length}</span>
              <NavBtn onClick={() => setCurrent((c) => Math.min(pages.length - 1, c + 1))} disabled={current === pages.length - 1}>
                <ChevronRight size={16} />
              </NavBtn>
              {rot !== 0 && !defineMode && (
                <span style={S.rotBadge}>{rot > 0 ? "+" : ""}{rot}° preview</span>
              )}
              {defineMode && (
                <span style={{ ...S.rotBadge, background: "#fff3e0", color: "#b45000" }}>
                  EDITING
                </span>
              )}
            </div>

            {/* Page image / column editor */}
            <div style={{ ...S.viewer, ...(ocrResults ? { flex: "0 0 auto", maxHeight: "45vh" } : {}) }}>
              {(defineMode || pageDefs[current]?.dataRect) ? (
                <ColumnEditor
                  pg={pg}
                  rot={rot}
                  colMarkers={pageDefs[current]?.colMarkers ?? []}
                  pageRect={{ dataRect: pageDefs[current]?.dataRect ?? null, metaRect: pageDefs[current]?.metaRect ?? null, headerRect: pageDefs[current]?.headerRect ?? null }}
                  onMarkersChange={(ms) => updatePageDef(current, { colMarkers: ms })}
                  onPageRectChange={(r) => updatePageDef(current, r)}
                  tool={defineTool}
                  onToolChange={setDefineTool}
                  onRowClick={handleMetaRowClick}
                  onHeaderRowClick={handleHeaderRowClick}
                  readOnly={!defineMode}
                />
              ) : (
                <img
                  src={pg.dataUrl}
                  alt={`Page ${current + 1}`}
                  style={{
                    maxWidth:        "100%",
                    maxHeight:       "100%",
                    objectFit:       "contain",
                    display:         "block",
                    transform:       rot !== 0 ? `rotate(${rot}deg)` : undefined,
                    transformOrigin: "center center",
                    transition:      "transform 0.12s ease",
                    boxShadow:       "0 4px 24px rgba(0,0,0,0.14)",
                  }}
                />
              )}
            </div>

            {/* OCR results table */}
            {ocrResults && (
              <OcrResultsPanel
                results={ocrResults}
                currentPage={current}
                colTypes={colTypes}
                onExport={exportCsv}
              />
            )}
          </>
        )}

      </div>
    </div>
  );
}

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.08em", color: COLORS.muted, fontWeight: 600 }}>
        {title}
      </div>
      <div style={{
        padding:        "10px 12px",
        background:     COLORS.bg,
        border:         `1px solid ${COLORS.border}`,
        borderRadius:   8,
        display:        "flex",
        flexDirection:  "column",
        gap:            4,
      }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, lineHeight: 1.7 }}>
      <span style={{ color: COLORS.muted }}>{label}</span>
      <span style={{
        color:         COLORS.text,
        fontFamily:    mono ? MONO_FONT : undefined,
        maxWidth:      160,
        overflow:      "hidden",
        textOverflow:  "ellipsis",
        whiteSpace:    "nowrap",
        textAlign:     "right",
      }}>
        {value}
      </span>
    </div>
  );
}

function RotBtn({ label, onClick }) {
  return <button style={S.rotBtn} onClick={onClick}>{label}</button>;
}

function FlashBtn({ style, onClick, children, disabled }) {
  const [flash, setFlash] = useState(false);
  const handleClick = () => {
    if (disabled) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 380);
    onClick?.();
  };
  return (
    <button
      disabled={disabled}
      style={{
        ...style,
        ...(flash ? { background: COLORS.accent, color: "#fff", borderColor: COLORS.accent, transform: "scale(0.95)" } : {}),
        transition: "background 0.12s, color 0.12s, transform 0.08s",
        opacity: disabled ? 0.4 : 1,
      }}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

function DefineRow({ label, onDraw, drawActive, onClickRow, clickActive, showCopy, onCopyToAll }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
      <span style={{ flex: 1, color: COLORS.text }}>{label}</span>
      {onClickRow && (
        <button
          style={{
            ...S.rotBtn, fontSize: 10, padding: "2px 8px",
            ...(clickActive ? { background: COLORS.accent, color: "#fff", borderColor: COLORS.accent } : {}),
          }}
          onClick={onClickRow}
        >
          Click row
        </button>
      )}
      {onDraw && (
        <button
          style={{
            ...S.rotBtn, fontSize: 10, padding: "2px 8px",
            ...(drawActive ? { background: COLORS.accent, color: "#fff", borderColor: COLORS.accent } : {}),
          }}
          onClick={onDraw}
        >
          Draw
        </button>
      )}
      {showCopy && (
        <FlashBtn style={{ ...S.rotBtn, fontSize: 10, padding: "2px 8px" }} onClick={onCopyToAll}>
          → All
        </FlashBtn>
      )}
    </div>
  );
}

function NavBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...S.navBtn,
      opacity: disabled ? 0.3 : 1,
      cursor:  disabled ? "default" : "pointer",
    }}>
      {children}
    </button>
  );
}

function OcrResultsPanel({ results, currentPage, colTypes = [], onExport }) {
  const [viewPage, setViewPage] = useState(currentPage);

  // Keep view in sync when the main viewer navigates
  useEffect(() => { setViewPage(currentPage); }, [currentPage]);

  const pageResult = results.pages[viewPage];
  const numCols    = pageResult?.numCols ?? 1;

  const cellStyle = {
    padding:     "3px 8px",
    border:      `1px solid ${COLORS.border}`,
    fontSize:    11,
    fontFamily:  MONO_FONT,
    color:       COLORS.text,
    whiteSpace:  "pre-wrap",
    maxWidth:    220,
    overflow:    "hidden",
    textOverflow: "ellipsis",
  };
  const thStyle   = { ...cellStyle, background: COLORS.surface, fontWeight: 600, color: COLORS.muted };
  const tickThStyle = { ...thStyle, background: "rgba(26,94,168,0.07)", color: "#1a5ea8" };
  const tickStyle = { ...cellStyle, background: "rgba(26,94,168,0.04)", textAlign: "center", color: "#1a5ea8" };
  const metaStyle = { ...cellStyle, background: "#fffbe6", color: "#7a5800", fontStyle: "italic" };

  return (
    <div style={{
      flex:       "1 1 0",
      minHeight:  0,
      display:    "flex",
      flexDirection: "column",
      borderTop:  `1px solid ${COLORS.border}`,
      overflow:   "hidden",
    }}>
      {/* Results toolbar */}
      <div style={{
        display:      "flex",
        alignItems:   "center",
        gap:          8,
        padding:      "5px 12px",
        background:   COLORS.surface,
        borderBottom: `1px solid ${COLORS.border}`,
        flexShrink:   0,
        fontSize:     11,
        color:        COLORS.muted,
      }}>
        <span style={{ fontFamily: MONO_FONT, fontSize: 10, letterSpacing: "0.06em" }}>OCR RESULTS</span>
        <span style={{ flex: 1 }} />
        {results.pages.map((p, i) => (
          <button key={i} onClick={() => setViewPage(i)}
            style={{
              padding: "1px 7px", fontSize: 10, fontFamily: MONO_FONT,
              border: `1px solid ${i === viewPage ? COLORS.accent : COLORS.border}`,
              borderRadius: 4, background: i === viewPage ? COLORS.accentSoft : COLORS.surface,
              color: i === viewPage ? COLORS.accent : COLORS.muted, cursor: "pointer",
            }}>
            {i + 1}
          </button>
        ))}
        <button onClick={onExport} style={{
          padding: "2px 10px", fontSize: 10, fontFamily: MONO_FONT,
          border: `1px solid ${COLORS.accent}`, borderRadius: 4,
          background: COLORS.accent, color: "#fff", cursor: "pointer",
        }}>
          Export CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: "8px 12px" }}>
        {!pageResult ? (
          <p style={{ ...S.hint, padding: 8 }}>No data defined for this page.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
            {pageResult.headerRow && (
              <thead>
                <tr>
                  {pageResult.headerRow.map((h, k) => (
                    <th key={k} style={colTypes[k] === 'tick' ? tickThStyle : thStyle}>
                      {h || <span style={{ color: COLORS.border }}>—</span>}
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {pageResult.metaText && (
                <tr>
                  <td colSpan={numCols} style={metaStyle}>{pageResult.metaText}</td>
                </tr>
              )}
              {pageResult.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={colTypes[ci] === 'tick' ? tickStyle : cellStyle}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

