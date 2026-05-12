import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import * as d3 from "d3";
import Papa from "papaparse";
import { COLORS, MONO_FONT } from "../styles/light-theme";
import fetchWithTimeout from "../dna-sequence-visualizer/helper-functions";
import MoreInfoWidget from "./widgets/MoreInfoWidget";

const C = {
  up: "#ff0000",
  down: "#00ff00",
  ns: "#a8b4c8",
  nsBorder: "#8a96ae",
  threshold: COLORS.warning,
  bg: COLORS.bg,
  panel: COLORS.surface,
  border: COLORS.border,
  text: COLORS.text,
  muted: COLORS.muted,
  accent: COLORS.accent,
};

function useDebounced(value, ms = 80) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ── Parser ────────────────────────────────────────────────────────────────────
function parseDeseq2(text) {
  const firstLine = text.split("\n")[0];
  const delim = firstLine.includes("\t") ? "\t" : ",";
  const result = Papa.parse(text, { header: true, delimiter: delim, skipEmptyLines: true });
  const parsed = result.data;
  if (!parsed.length) return null;

  const cols = result.meta.fields;
  const find = (...names) =>
    cols.find((c) => names.some((n) => c.toLowerCase() === n.toLowerCase()));

  const idCol = cols[0];
  const log2fcCol = find("log2FoldChange", "log2fc", "lfc", "logfc", "log2_fold_change");
  const pvalCol = find("pvalue", "pval", "p.value", "p_value", "PValue", "P.Value");
  const padjCol = find("padj", "adj.p", "adj_p", "FDR", "q.value", "BH", "adj.P.Val");
  const baseMeanCol = find("baseMean", "basemean", "AveExpr", "meanExpr", "AvgExpr");

  if (!log2fcCol || !pvalCol) return null;

  return parsed
    .map((row) => ({
      id: row[idCol] || "",
      log2FC: +row[log2fcCol],
      pvalue: +row[pvalCol],
      padj: padjCol ? +row[padjCol] : null,
      baseMean: baseMeanCol ? +row[baseMeanCol] : null,
    }))
    .filter(
      (d) =>
        isFinite(d.log2FC) &&
        // pvalue === 0 is valid: R floating-point underflow on very significant genes
        isFinite(d.pvalue) &&
        d.pvalue >= 0 &&
        (d.padj === null || isFinite(d.padj)),
    );
}

// ── Ensembl batch lookup ──────────────────────────────────────────────────────
async function fetchEnsemblSymbols(ids, onProgress) {
  const ensIds = [
    ...new Set(ids.filter((id) => /^ENS[A-Z]*G\d+/.test(id || ""))),
  ];
  if (!ensIds.length) return {};

  const results = {};
  const size = 200;
  for (let i = 0; i < ensIds.length; i += size) {
    const batch = ensIds.slice(i, i + size);
    try {
      const r = await fetchWithTimeout(
        "https://rest.ensembl.org/lookup/id/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ids: batch }),
        },
        8000,
      );
      if (r.ok) {
        const data = await r.json();
        Object.entries(data).forEach(([id, info]) => {
          if (info?.display_name) results[id] = info.display_name;
        });
      }
    } catch (_) {}
    onProgress(Math.min(100, Math.round(((i + size) / ensIds.length) * 100)));
  }
  return results;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function VolcanoPlot() {
  const [genes, setGenes] = useState([]);
  const [symbols, setSymbols] = useState({});
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [symbolProgress, setSymbolProgress] = useState(null);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [resizeTick, setResizeTick] = useState(0);
  const [plotDims, setPlotDims] = useState(null); // { w, h } px

  // Controls (live — drive slider UI immediately)
  const [pCutoff, setPCutoff] = useState(0.05);
  const [fcCutoff, setFcCutoff] = useState(1.0);
  const [useAdj, setUseAdj] = useState(true);
  const [topN, setTopN] = useState(7);
  const [fetchSym, setFetchSym] = useState(true);
  const [pointSize, setPointSize] = useState(3);
  const [lfcMin, setLfcMin] = useState(-15);
  const [lfcMax, setLfcMax] = useState(15);

  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const fileInputRef = useRef(null);

  // D3 layer refs
  const scalesRef = useRef(null);   // { xSc, ySc, iW, iH, getEffP }
  const layersRef = useRef({});     // { thr, pts, lbl }
  const symbolsRef = useRef(symbols);
  useEffect(() => { symbolsRef.current = symbols; }, [symbols]);

  // Debounced render values
  const dPCutoff = useDebounced(pCutoff);
  const dFcCutoff = useDebounced(fcCutoff);
  const dPointSize = useDebounced(pointSize);
  const dTopN = useDebounced(topN);

  // Live classify — header counts (instant)
  const classified = useMemo(
    () =>
      genes.map((g) => {
        const p = useAdj && g.padj != null ? g.padj : g.pvalue;
        const sig = p <= pCutoff && Math.abs(g.log2FC) >= fcCutoff;
        return { ...g, effectiveP: p, sig, up: g.log2FC > 0 };
      }),
    [genes, pCutoff, fcCutoff, useAdj],
  );

  // Debounced classify — drives D3 coloring
  const classifiedD3 = useMemo(
    () =>
      genes.map((g) => {
        const p = useAdj && g.padj != null ? g.padj : g.pvalue;
        const sig = p <= dPCutoff && Math.abs(g.log2FC) >= dFcCutoff;
        return { ...g, effectiveP: p, sig, up: g.log2FC > 0 };
      }),
    [genes, dPCutoff, dFcCutoff, useAdj],
  );

  const sigUp = classified.filter((g) => g.sig && g.up).length;
  const sigDown = classified.filter((g) => g.sig && !g.up).length;

  // Top genes: within visible LFC range, p=0 allowed (most significant)
  const topGenesD3 = useMemo(
    () =>
      [...classifiedD3]
        .filter(
          (g) =>
            g.sig &&
            isFinite(g.effectiveP) &&
            g.effectiveP >= 0 &&
            g.log2FC >= lfcMin &&
            g.log2FC <= lfcMax,
        )
        .sort((a, b) => a.effectiveP - b.effectiveP)
        .slice(0, dTopN),
    [classifiedD3, dTopN, lfcMin, lfcMax],
  );

  const topIdsD3 = useMemo(
    () => new Set(topGenesD3.map((g) => g.id)),
    [topGenesD3],
  );

  // ── File handling ────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (file) => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setFileName(file.name);
    setSymbols({});
    setSymbolProgress(null);
    try {
      const text = await file.text();
      const parsed = parseDeseq2(text);
      if (!parsed || parsed.length === 0) {
        setError("Could not parse. Expected DESeq2 CSV/TSV with log2FoldChange + pvalue columns.");
        setGenes([]);
      } else {
        setGenes(parsed);
      }
    } catch (e) {
      setError("Read error: " + e.message);
    }
    setLoading(false);
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragging(false);
      loadFile(e.dataTransfer?.files?.[0]);
    },
    [loadFile],
  );

  // ── Effect A: Full SVG rebuild — new data, useAdj toggle, resize, LFC range ──
  useEffect(() => {
    if (!genes.length || !svgRef.current || !wrapRef.current) return;
    const wrap = wrapRef.current;
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const m = { t: 30, r: 30, b: 55, l: 65 };
    const iW = W - m.l - m.r;
    const iH = H - m.t - m.b;

    // Annotate all genes with effectiveP and up flag
    const data = genes.map((g) => ({
      ...g,
      effectiveP: useAdj && g.padj != null ? g.padj : g.pvalue,
      up: g.log2FC > 0,
    }));

    // p=0 genes: substitute with 1% of the smallest positive p-value so they
    // plot visibly above all finite-p genes without blowing up the y-axis
    const minPosPval = d3.min(data.filter((d) => d.effectiveP > 0), (d) => d.effectiveP);
    const pZeroSub = minPosPval != null ? minPosPval * 0.01 : 1e-300;
    const getEffP = (p) => (p === 0 ? pZeroSub : p);

    const yVals = data.map((d) => -Math.log10(getEffP(d.effectiveP)));
    const yMax = (d3.max(yVals.filter(isFinite)) || 10) * 1.08;

    const xSc = d3.scaleLinear().domain([lfcMin, lfcMax]).range([0, iW]);
    const ySc = d3.scaleLinear().domain([0, yMax]).range([iH, 0]);
    scalesRef.current = { xSc, ySc, iW, iH, getEffP };
    setPlotDims({ w: W, h: H });

    const svg = d3.select(svgRef.current).attr("width", W).attr("height", H);
    svg.selectAll("*").remove();
    layersRef.current = {};

    const root = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);

    // Grid
    root
      .append("g")
      .call(d3.axisLeft(ySc).tickSize(-iW).tickFormat(""))
      .call((g) => g.select(".domain").remove())
      .call((g) =>
        g.selectAll("line").attr("stroke", COLORS.border).attr("stroke-dasharray", "4,4"),
      );

    // Layer groups (z-order: thresholds → points → labels)
    layersRef.current.thr = root.append("g");
    layersRef.current.pts = root.append("g");
    layersRef.current.lbl = root.append("g");

    // Draw circles at fixed positions (Effect B updates colours/sizes)
    const visibleData = data.filter((d) => d.log2FC >= lfcMin && d.log2FC <= lfcMax);
    layersRef.current.pts
      .selectAll("circle")
      .data(visibleData, (d) => d.id)
      .join("circle")
      .attr("cx", (d) => xSc(d.log2FC))
      .attr("cy", (d) => ySc(-Math.log10(getEffP(d.effectiveP))))
      .attr("r", pointSize - 0.5)
      .attr("fill", C.ns)
      .attr("opacity", 0.5)
      .style("cursor", "pointer")
      .on("mousemove", (event, d) => {
        setTooltip({
          x: event.clientX,
          y: event.clientY,
          gene: d,
          symbol:
            symbolsRef.current[d.id] ||
            symbolsRef.current[d.id?.replace(/\.\d+$/, "")] ||
            null,
        });
      })
      .on("mouseleave", () => setTooltip(null));

    // Axes
    const xAx = root
      .append("g")
      .attr("transform", `translate(0,${iH})`)
      .call(d3.axisBottom(xSc).ticks(8));
    const yAx = root.append("g").call(d3.axisLeft(ySc).ticks(8));

    [xAx, yAx].forEach((ax) => {
      ax.select(".domain").attr("stroke", C.muted);
      ax.selectAll("line").attr("stroke", C.muted);
      ax.selectAll("text").attr("fill", C.text).attr("font-size", 10).attr("font-family", MONO_FONT);
    });

    root.append("text")
      .attr("x", iW / 2).attr("y", iH + 46)
      .attr("text-anchor", "middle").attr("fill", C.text)
      .attr("font-size", 11).attr("font-family", MONO_FONT)
      .text("log₂ Fold Change");

    root.append("text")
      .attr("transform", "rotate(-90)").attr("x", -iH / 2).attr("y", -50)
      .attr("text-anchor", "middle").attr("fill", C.text)
      .attr("font-size", 11).attr("font-family", MONO_FONT)
      .text(useAdj ? "−log₁₀(padj)" : "−log₁₀(pvalue)");
  }, [genes, useAdj, resizeTick, lfcMin, lfcMax]);

  // ── Effect B: Update circle colours/sizes — no DOM creation ─────────────────
  useEffect(() => {
    const ptsG = layersRef.current.pts;
    if (!ptsG || !classifiedD3.length) return;
    const ps = dPointSize;
    // Only update circles that exist in the current visible set
    const visible = classifiedD3.filter((d) => d.log2FC >= lfcMin && d.log2FC <= lfcMax);
    ptsG.selectAll("circle")
      .data(visible, (d) => d.id)
      .attr("r", (d) => (topIdsD3.has(d.id) ? ps + 1.5 : d.sig ? ps : ps - 0.5))
      .attr("fill", (d) => (d.sig ? (d.up ? C.up : C.down) : C.ns))
      .attr("stroke", (d) =>
        topIdsD3.has(d.id) ? "rgba(0,0,0,0.4)" : d.sig ? "none" : C.nsBorder,
      )
      .attr("stroke-width", (d) => (topIdsD3.has(d.id) ? 1 : 0.3))
      .attr("opacity", (d) => (d.sig ? 0.88 : 0.5));
  }, [classifiedD3, dPointSize, topIdsD3, lfcMin, lfcMax, resizeTick]);

  // ── Effect C: Move threshold lines — only within visible LFC range ───────────
  useEffect(() => {
    const thrG = layersRef.current.thr;
    const sc = scalesRef.current;
    if (!thrG || !sc) return;
    const { xSc, ySc, iW, iH } = sc;
    const yThr = -Math.log10(dPCutoff);
    thrG.selectAll("*").remove();

    // Horizontal p-value threshold
    thrG.append("line")
      .attr("x1", 0).attr("x2", iW)
      .attr("y1", ySc(yThr)).attr("y2", ySc(yThr))
      .attr("stroke", C.threshold).attr("stroke-dasharray", "7,4")
      .attr("stroke-width", 1).attr("opacity", 0.7);

    // Vertical FC thresholds — only draw if the line falls within the visible x range
    for (const fc of [-dFcCutoff, dFcCutoff]) {
      if (fc >= lfcMin && fc <= lfcMax) {
        const x = xSc(fc);
        thrG.append("line")
          .attr("x1", x).attr("x2", x)
          .attr("y1", 0).attr("y2", iH)
          .attr("stroke", C.threshold).attr("stroke-dasharray", "7,4")
          .attr("stroke-width", 1).attr("opacity", 0.7);
      }
    }
  }, [dPCutoff, dFcCutoff, lfcMin, lfcMax, resizeTick]);

  // ── Effect D: Redraw labels — only top N elements ────────────────────────────
  useEffect(() => {
    const lblG = layersRef.current.lbl;
    const sc = scalesRef.current;
    if (!lblG || !sc) return;
    const { xSc, ySc, getEffP } = sc;
    const ps = dPointSize;
    lblG.selectAll("*").remove();

    topGenesD3.forEach((gene) => {
      const cx = xSc(gene.log2FC);
      const cy = ySc(-Math.log10(getEffP(gene.effectiveP)));
      const right = gene.log2FC > 0;
      const dx = right ? ps + 6 : -(ps + 6);
      const anchor = right ? "start" : "end";
      const isEnsembl = /^ENS[A-Z]*G\d+/.test(gene.id || "");
      const label =
        symbols[gene.id] ||
        symbols[gene.id?.replace(/\.\d+$/, "")] ||
        (isEnsembl ? null : gene.id?.split(".")[0] || gene.id);
      if (!label) return;

      lblG.append("line")
        .attr("x1", cx + (right ? ps : -ps)).attr("y1", cy)
        .attr("x2", cx + dx * 0.6).attr("y2", cy - 6)
        .attr("stroke", "rgba(0,0,0,0.2)").attr("stroke-width", 0.7);

      lblG.append("text")
        .attr("x", cx + dx).attr("y", cy - 6)
        .attr("text-anchor", anchor)
        .attr("font-size", 10.5).attr("font-family", MONO_FONT)
        .attr("fill", gene.up ? C.up : C.down)
        .attr("opacity", 0.92)
        .text(label);
    });
  }, [topGenesD3, symbols, dPointSize, resizeTick]);

  // ── Effect E: Fetch Ensembl symbols for current top genes ────────────────────
  useEffect(() => {
    if (!fetchSym || !topGenesD3.length) return;
    const needed = topGenesD3
      .map((g) => g.id.replace(/\.\d+$/, ""))
      .filter((id) => /^ENS[A-Z]*G\d+/.test(id) && !symbolsRef.current[id]);
    if (!needed.length) return;

    let cancelled = false;
    setSymbolProgress(0);
    fetchEnsemblSymbols(needed, setSymbolProgress).then((fresh) => {
      if (!cancelled) {
        setSymbols((prev) => ({ ...prev, ...fresh }));
        setSymbolProgress(null);
      }
    });
    return () => { cancelled = true; };
  }, [topGenesD3, fetchSym]);

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportPlot = useCallback((format) => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const w = +svgEl.getAttribute("width");
    const h = +svgEl.getAttribute("height");
    const scale = EXPORT_SCALE;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const mime = format === "jpg" ? "image/jpeg" : "image/png";
      const a = document.createElement("a");
      a.href = canvas.toDataURL(mime, 0.95);
      a.download = `${(fileName || "volcano").replace(/\.[^.]+$/, "")}.${format}`;
      a.click();
    };
    img.src = url;
  }, [fileName]);

  // ── Resize observer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!genes.length) return;
    const obs = new ResizeObserver(() => setResizeTick((n) => n + 1));
    if (wrapRef.current) obs.observe(wrapRef.current);
    return () => obs.disconnect();
  }, [genes]);

  return (
    <div
      style={{
        background: C.bg, color: C.text, height: "100%",
        display: "flex", flexDirection: "column", fontFamily: MONO_FONT, overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <header
        style={{
          display: "flex", alignItems: "center", gap: 20,
          padding: "10px 20px", borderBottom: `1px solid ${C.border}`,
          background: C.panel, flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, letterSpacing: "0.25em", color: C.accent, fontWeight: 600 }}>
          VOLCANO
        </span>
        {genes.length > 0 && (
          <>
            <Chip color={C.up}>↑ {sigUp} up</Chip>
            <Chip color={C.down}>↓ {sigDown} down</Chip>
            <span style={{ fontSize: 10, color: C.muted }}>
              {genes.length.toLocaleString()} genes · {fileName}
            </span>
          </>
        )}
        {symbolProgress !== null && (
          <span style={{ fontSize: 10, color: C.threshold }}>
            fetching symbols {symbolProgress}%
          </span>
        )}
        <div style={{ flex: 1 }} />
        {plotDims && (
          <span style={{ fontSize: 9, color: C.muted, letterSpacing: "0.05em" }}>
            {plotDims.w * EXPORT_SCALE} × {plotDims.h * EXPORT_SCALE} px
          </span>
        )}
        {genes.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {["png", "jpg"].map((fmt) => (
              <button
                key={fmt}
                onClick={() => exportPlot(fmt)}
                style={{
                  fontSize: 10, color: C.accent, background: "none",
                  border: `1px solid ${C.accent}44`, borderRadius: 3,
                  padding: "3px 10px", cursor: "pointer",
                }}
              >
                ↓ {fmt.toUpperCase()}
              </button>
            ))}
            <button
              onClick={() => { setGenes([]); setSymbols({}); setFileName(null); setPlotDims(null); }}
              style={{
                fontSize: 10, color: C.muted, background: "none",
                border: `1px solid ${C.border}`, borderRadius: 3,
                padding: "3px 10px", cursor: "pointer",
              }}
            >
              clear
            </button>
          </div>
        )}
        <MoreInfoWidget />
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* ── Controls ── */}
        <aside
          style={{
            width: 210, background: C.panel, borderRight: `1px solid ${C.border}`,
            padding: "20px 16px", display: "flex", flexDirection: "column",
            gap: 24, overflowY: "auto", flexShrink: 0,
          }}
        >
          <Section label="SIGNIFICANCE">
            <Row label={useAdj ? "padj ≤" : "pvalue ≤"} val={pCutoff.toFixed(3)}>
              <input type="range" min={0.0005} max={0.2} step={0.0005}
                value={pCutoff} onChange={(e) => setPCutoff(+e.target.value)} style={sliderStyle} />
            </Row>
            <Toggle label="use padj" on={useAdj} set={setUseAdj} />
          </Section>

          <Section label="FOLD CHANGE">
            <Row label="|log₂FC| ≥" val={fcCutoff.toFixed(1)}>
              <input type="range" min={0} max={5} step={0.1}
                value={fcCutoff} onChange={(e) => setFcCutoff(+e.target.value)} style={sliderStyle} />
            </Row>
          </Section>

          <Section label="LFC RANGE">
            <LfcRangeInput label="min" value={lfcMin} onCommit={setLfcMin} />
            <LfcRangeInput label="max" value={lfcMax} onCommit={setLfcMax} />
          </Section>

          <Section label="LABELS">
            <Row label="top N" val={topN}>
              <input type="range" min={0} max={20} step={1}
                value={topN} onChange={(e) => setTopN(+e.target.value)} style={sliderStyle} />
            </Row>
            <Toggle label="Ensembl symbols" on={fetchSym} set={setFetchSym} />
          </Section>

          <Section label="POINTS">
            <Row label="size" val={pointSize}>
              <input type="range" min={1} max={7} step={0.5}
                value={pointSize} onChange={(e) => setPointSize(+e.target.value)} style={sliderStyle} />
            </Row>
          </Section>

          {genes.length > 0 && (
            <Section label="LOAD NEW">
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  fontSize: 10, color: C.muted, background: "none",
                  border: `1px solid ${C.border}`, borderRadius: 3,
                  padding: "5px 0", cursor: "pointer", width: "100%",
                }}
              >
                browse file
              </button>
              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt"
                style={{ display: "none" }} onChange={(e) => loadFile(e.target.files?.[0])} />
            </Section>
          )}

          {/* Legend */}
          <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {[[C.up, "up-reg (sig)"], [C.down, "down-reg (sig)"], [C.ns, "not sig"]].map(
              ([col, lbl]) => (
                <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 9, color: C.muted }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: col, border: `1px solid ${C.border}`, flexShrink: 0 }} />
                  {lbl}
                </div>
              ),
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 9, color: C.muted }}>
              <div style={{ width: 18, height: 1, background: C.threshold, flexShrink: 0 }} />
              thresholds
            </div>
          </div>
        </aside>

        {/* ── Plot area ── */}
        <main style={{ flex: 1, position: "relative", overflow: "auto", background: C.bg }}>
          {genes.length === 0 ? (
            <DropZone
              dragging={dragging} loading={loading} error={error}
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onBrowse={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt"
                style={{ display: "none" }} onChange={(e) => loadFile(e.target.files?.[0])} />
            </DropZone>
          ) : (
            <div
              ref={wrapRef}
              style={{
                width: "100%", height: "100%",
                resize: "both", overflow: "hidden",
                minWidth: 320, minHeight: 220,
                boxSizing: "border-box",
              }}
            >
              <svg ref={svgRef} style={{ width: "100%", height: "100%", display: "block" }} />
            </div>
          )}
          {tooltip && <GeneTooltip {...tooltip} />}
        </main>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LfcRangeInput({ label, value, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = parseFloat(draft);
    if (isFinite(n)) onCommit(n);
    else setDraft(String(value));
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, color: C.muted }}>
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        style={{
          width: 60, fontSize: 10, fontFamily: MONO_FONT,
          background: COLORS.bg, border: `1px solid ${C.border}`,
          borderRadius: 3, padding: "2px 6px", color: C.text,
          textAlign: "right",
        }}
      />
    </div>
  );
}

function DropZone({ dragging, loading, error, onDrop, onDragOver, onDragLeave, onBrowse, children }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
        style={{
          width: 420, padding: "48px 40px", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 18, textAlign: "center",
          border: `2px dashed ${dragging ? C.accent : C.border}`, borderRadius: 6,
          background: dragging ? `${C.accent}08` : C.panel,
          transition: "border-color 0.2s, background 0.2s",
        }}
      >
        {loading ? (
          <span style={{ color: C.muted, fontSize: 12 }}>parsing…</span>
        ) : (
          <>
            <div style={{ fontSize: 40, opacity: 0.2, lineHeight: 1 }}>⬇</div>
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.9 }}>
              drop DESeq2 results here
              <br />
              <span style={{ fontSize: 10, opacity: 0.6 }}>CSV or TSV · columns: log2FoldChange, pvalue, padj</span>
            </div>
            <button
              onClick={onBrowse}
              style={{ fontSize: 10, color: C.accent, background: "none", border: `1px solid ${C.border}`, borderRadius: 3, padding: "6px 16px", cursor: "pointer" }}
            >
              browse file
            </button>
            {error && <div style={{ color: COLORS.error, fontSize: 10, maxWidth: 320, lineHeight: 1.6 }}>{error}</div>}
          </>
        )}
        {children}
      </div>
    </div>
  );
}

function GeneTooltip({ x, y, gene, symbol }) {
  return (
    <div
      style={{
        position: "fixed", left: x + 14, top: y - 10,
        pointerEvents: "none", zIndex: 100,
        background: COLORS.surface, border: `1px solid ${COLORS.border}`,
        borderRadius: 4, padding: "8px 12px", fontSize: 10, lineHeight: 2,
        color: COLORS.text, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", fontFamily: MONO_FONT,
      }}
    >
      <div style={{ color: gene.up ? C.up : C.down, fontWeight: 600 }}>
        {symbol || gene.id}
      </div>
      {symbol && gene.id !== symbol && <div style={{ color: COLORS.muted }}>{gene.id}</div>}
      <div>log₂FC&nbsp;&nbsp;<span style={{ color: C.threshold }}>{gene.log2FC.toFixed(3)}</span></div>
      <div>pvalue&nbsp;&nbsp;<span style={{ color: C.threshold }}>{gene.pvalue === 0 ? "< 5e-324" : gene.pvalue.toExponential(2)}</span></div>
      {gene.padj != null && (
        <div>padj&nbsp;&nbsp;&nbsp;&nbsp;<span style={{ color: C.threshold }}>{gene.padj === 0 ? "< 5e-324" : gene.padj.toExponential(2)}</span></div>
      )}
      {gene.baseMean != null && (
        <div>baseMean&nbsp;<span style={{ color: COLORS.muted }}>{gene.baseMean.toFixed(1)}</span></div>
      )}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 8, letterSpacing: "0.22em", color: C.muted, marginBottom: 10 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

function Row({ label, val, children }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: C.text, fontWeight: 600 }}>{val}</span>
      </div>
      {children}
    </div>
  );
}

function Toggle({ label, on, set }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, color: C.muted }}>
      <span>{label}</span>
      <button
        onClick={() => set(!on)}
        style={{ width: 32, height: 16, borderRadius: 8, border: "none", cursor: "pointer", background: on ? C.accent : COLORS.border, position: "relative", transition: "background 0.25s", padding: 0 }}
      >
        <div style={{ width: 12, height: 12, borderRadius: 6, background: "white", position: "absolute", top: 2, left: on ? 17 : 2, transition: "left 0.2s" }} />
      </button>
    </div>
  );
}

function Chip({ color, children }) {
  return (
    <span style={{ fontSize: 10, color, border: `1px solid ${color}44`, borderRadius: 3, padding: "1px 8px" }}>
      {children}
    </span>
  );
}

const sliderStyle = { width: "100%", accentColor: C.accent, cursor: "pointer" };
const EXPORT_SCALE = 2;
