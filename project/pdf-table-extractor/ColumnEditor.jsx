import { useState, useEffect, useRef } from "react";
import { COLORS, MONO_FONT } from "../styles/light-theme";
import { bakePage } from "./pageAnalysis";

/**
 * Props
 *   pg, rot           — page image + rotation
 *   colMarkers        — number[]  per-page x-fractions
 *   pageRect          — { dataRect, metaRect }
 *   onMarkersChange   — (markers) => void
 *   onPageRectChange  — (pageRect) => void
 *   tool              — "rect-data" | "rect-meta" | "none"
 *   onToolChange      — (tool) => void
 *   readOnly          — boolean: show adornments but disable interaction
 */
export default function ColumnEditor({
  pg, rot,
  colMarkers, pageRect,
  onMarkersChange, onPageRectChange,
  tool, onToolChange,
  onRowClick,
  onHeaderRowClick,
  readOnly = false,
}) {
  const [bakedUrl, setBakedUrl]         = useState(null);
  const [drag, setDrag]                 = useState(null);         // rect draw: { start, current }
  const [draggingIdx, setDraggingIdx]   = useState(null);         // marker drag index
  const [draggingEdge, setDraggingEdge] = useState(null);         // 'top'|'bottom'|'left'|'right'
  const [hoverY, setHoverY]             = useState(null);         // meta-click hover band
  const imgRef = useRef(null);

  useEffect(() => {
    if (!pg) return;
    let alive = true;
    bakePage(pg.dataUrl, pg.w, pg.h, rot).then(c => {
      if (alive) setBakedUrl(c.toDataURL("image/jpeg", 0.9));
    });
    return () => { alive = false; };
  }, [pg, rot]);

  // Client coords → image fractions (0–1, clamped)
  const toFrac = (cx, cy) => {
    const r = imgRef.current?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: Math.max(0, Math.min(1, (cx - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (cy - r.top)  / r.height)),
    };
  };

  const normRect = (a, b) => ({
    x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y),
    x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y),
  });

  // Which edge of rect is the point near? Returns 'top'|'bottom'|'left'|'right'|null
  const nearEdge = (f, rect) => {
    const T = 0.018;
    if (Math.abs(f.y - rect.y1) < T && f.x > rect.x1 - T && f.x < rect.x2 + T) return "top";
    if (Math.abs(f.y - rect.y2) < T && f.x > rect.x1 - T && f.x < rect.x2 + T) return "bottom";
    if (Math.abs(f.x - rect.x1) < T && f.y > rect.y1 - T && f.y < rect.y2 + T) return "left";
    if (Math.abs(f.x - rect.x2) < T && f.y > rect.y1 - T && f.y < rect.y2 + T) return "right";
    return null;
  };

  const { dataRect, metaRect, headerRect } = pageRect ?? {};

  const onMouseDown = (e) => {
    if (readOnly) return;
    e.preventDefault();
    const f = toFrac(e.clientX, e.clientY);
    if (!f) return;

    // Row-click modes: stay in mode for rapid multi-page use
    if (tool === "meta-click")   { onRowClick?.(f.y);       return; }
    if (tool === "header-click") { onHeaderRowClick?.(f.y); return; }

    // Drawing a new rectangle
    if (tool === "rect-data" || tool === "rect-meta") {
      setDrag({ start: f, current: f });
      return;
    }

    // tool === "none"
    if (dataRect) {
      // Edge drag takes priority
      const edge = nearEdge(f, dataRect);
      if (edge) { setDraggingEdge(edge); return; }

      // Marker drag
      const SNAP = 0.015;
      const mi = colMarkers.findIndex(mx => Math.abs(mx - f.x) < SNAP);
      if (mi >= 0) { setDraggingIdx(mi); return; }

      // Click inside → add column-start marker
      if (f.x > dataRect.x1 && f.x < dataRect.x2 && f.y > dataRect.y1 && f.y < dataRect.y2)
        onMarkersChange([...colMarkers, f.x].sort((a, b) => a - b));
    }
  };

  const onMouseMove = (e) => {
    if (readOnly) return;
    const f = toFrac(e.clientX, e.clientY);
    if (!f) return;

    if (tool === "meta-click" || tool === "header-click") { setHoverY(f.y); return; }

    if (drag) {
      setDrag(d => ({ ...d, current: f }));
      return;
    }
    if (draggingEdge && dataRect) {
      const r = { ...dataRect };
      if (draggingEdge === "top")    r.y1 = Math.min(f.y, r.y2 - 0.01);
      if (draggingEdge === "bottom") r.y2 = Math.max(f.y, r.y1 + 0.01);
      if (draggingEdge === "left")   r.x1 = Math.min(f.x, r.x2 - 0.01);
      if (draggingEdge === "right")  r.x2 = Math.max(f.x, r.x1 + 0.01);
      onPageRectChange({ ...(pageRect ?? {}), dataRect: r });
      return;
    }
    if (draggingIdx !== null) {
      const ms = [...colMarkers];
      ms[draggingIdx] = f.x;
      onMarkersChange(ms.sort((a, b) => a - b));
    }
  };

  const onMouseLeave = () => { setHoverY(null); onMouseUp(); };

  const onMouseUp = () => {
    if (drag) {
      const r = normRect(drag.start, drag.current);
      if (r.x2 - r.x1 > 0.01 && r.y2 - r.y1 > 0.01) {
        if (tool === "rect-data") {
          onPageRectChange({ ...(pageRect ?? {}), dataRect: r });
          onToolChange("none");
        } else if (tool === "rect-meta") {
          onPageRectChange({ ...(pageRect ?? {}), metaRect: r });
          onToolChange("none");
        } else if (tool === "rect-header") {
          onPageRectChange({ ...(pageRect ?? {}), headerRect: r });
          onToolChange("none");
        }
      }
      setDrag(null);
    }
    setDraggingEdge(null);
    setDraggingIdx(null);
  };

  const removeMarker = (i) =>
    onMarkersChange(colMarkers.filter((_, j) => j !== i));

  const pct   = v => `${(v * 100).toFixed(2)}%`;
  const liveR = drag ? normRect(drag.start, drag.current) : null;
  const ac    = readOnly ? COLORS.border : COLORS.accent;

  // Cursor for the SVG surface
  const svgCursor = readOnly ? "default"
    : (tool === "meta-click" || tool === "header-click") ? "row-resize"
    : tool !== "none" ? "crosshair"
    : "default";

  return (
    <div style={{ position: "relative", display: "inline-block", lineHeight: 0, maxWidth: "100%" }}>
      {bakedUrl
        ? <img ref={imgRef} src={bakedUrl} alt="page"
            style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100vh - 120px)", boxShadow: "0 4px 24px rgba(0,0,0,0.14)" }} />
        : <div style={{ width: 400, height: 300, display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted, fontSize: 12 }}>
            Rendering…
          </div>
      }

      {bakedUrl && (
        <svg
          style={{
            position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
            cursor: svgCursor, userSelect: "none",
            pointerEvents: readOnly ? "none" : "all",
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
        >
          {/* ── Data region ──────────────────────────────────────────────── */}
          {dataRect && (
            <rect x={pct(dataRect.x1)} y={pct(dataRect.y1)}
              width={pct(dataRect.x2 - dataRect.x1)} height={pct(dataRect.y2 - dataRect.y1)}
              fill={readOnly ? "transparent" : "rgba(0,188,180,0.05)"}
              stroke={ac} strokeWidth={readOnly ? 1 : 2}
              strokeDasharray={readOnly ? "6 3" : "none"} />
          )}

          {/* ── Edge drag handles (invisible hit areas + cursor) ─────────── */}
          {dataRect && !readOnly && (() => {
            const T = "1.8%";
            const edges = [
              { x: pct(dataRect.x1), y: pct(dataRect.y1 - 0.009), w: pct(dataRect.x2 - dataRect.x1), h: T, cur: "ns-resize" },
              { x: pct(dataRect.x1), y: pct(dataRect.y2 - 0.009), w: pct(dataRect.x2 - dataRect.x1), h: T, cur: "ns-resize" },
              { x: pct(dataRect.x1 - 0.009), y: pct(dataRect.y1), w: T, h: pct(dataRect.y2 - dataRect.y1), cur: "ew-resize" },
              { x: pct(dataRect.x2 - 0.009), y: pct(dataRect.y1), w: T, h: pct(dataRect.y2 - dataRect.y1), cur: "ew-resize" },
            ];
            return edges.map((e, i) => (
              <rect key={i} x={e.x} y={e.y} width={e.w} height={e.h}
                fill="transparent" style={{ cursor: e.cur }} />
            ));
          })()}

          {/* ── Metadata strip ───────────────────────────────────────────── */}
          {metaRect && (
            <>
              <rect x={pct(metaRect.x1)} y={pct(metaRect.y1)}
                width={pct(metaRect.x2 - metaRect.x1)} height={pct(metaRect.y2 - metaRect.y1)}
                fill="rgba(180,120,0,0.07)" stroke="#b45000" strokeWidth={readOnly ? 1 : 2} strokeDasharray="6 3" />
              <text x={pct(metaRect.x1 + 0.004)} y={pct(metaRect.y1 + 0.022)}
                fontSize={10} fontFamily={MONO_FONT} fill="#b45000"
                style={{ pointerEvents: "none" }}>META</text>
            </>
          )}

          {/* ── Column header row ────────────────────────────────────────── */}
          {headerRect && (
            <>
              <rect x={pct(headerRect.x1)} y={pct(headerRect.y1)}
                width={pct(headerRect.x2 - headerRect.x1)} height={pct(headerRect.y2 - headerRect.y1)}
                fill="rgba(26,94,168,0.07)" stroke="#1a5ea8" strokeWidth={readOnly ? 1 : 2} strokeDasharray="6 3" />
              <text x={pct(headerRect.x1 + 0.004)} y={pct(headerRect.y1 + 0.022)}
                fontSize={10} fontFamily={MONO_FONT} fill="#1a5ea8"
                style={{ pointerEvents: "none" }}>HEADER</text>
            </>
          )}

          {/* ── Col 1 label ──────────────────────────────────────────────── */}
          {dataRect && (
            <text x={pct(dataRect.x1 + 0.004)} y={pct(dataRect.y1 + 0.022)}
              fontSize={10} fontFamily={MONO_FONT} fill={ac}
              style={{ pointerEvents: "none" }}>1</text>
          )}

          {/* ── Column-start markers ─────────────────────────────────────── */}
          {dataRect && colMarkers.map((mx, i) => (
            <g key={i}>
              <line x1={pct(mx)} y1={pct(dataRect.y1)} x2={pct(mx)} y2={pct(dataRect.y2)}
                stroke={ac} strokeWidth={readOnly ? 1 : 1.5} strokeDasharray="5 3" />
              {!readOnly && (
                <line x1={pct(mx)} y1={pct(dataRect.y1)} x2={pct(mx)} y2={pct(dataRect.y2)}
                  stroke="transparent" strokeWidth={14} style={{ cursor: "ew-resize" }}
                  onDoubleClick={e => { e.stopPropagation(); removeMarker(i); }} />
              )}
              <text x={pct(mx + 0.004)} y={pct(dataRect.y1 + 0.022)}
                fontSize={10} fontFamily={MONO_FONT} fill={ac}
                style={{ pointerEvents: "none" }}>{i + 2}</text>
            </g>
          ))}

          {/* ── Meta-click hover band ───────────────────────────────────── */}
          {(tool === "meta-click" || tool === "header-click") && hoverY !== null && dataRect && (
            <rect x={pct(dataRect.x1)} y={pct(hoverY)}
              width={pct(dataRect.x2 - dataRect.x1)} height="10"
              fill={tool === "header-click" ? "rgba(26,94,168,0.5)" : "rgba(180,120,0,0.5)"}
              style={{ transform: "translateY(-5px)", pointerEvents: "none" }} />
          )}

          {/* ── Live drawing preview ─────────────────────────────────────── */}
          {liveR && (
            <rect x={pct(liveR.x1)} y={pct(liveR.y1)}
              width={pct(liveR.x2 - liveR.x1)} height={pct(liveR.y2 - liveR.y1)}
              fill={tool === "rect-meta" ? "rgba(180,120,0,0.07)" : tool === "rect-header" ? "rgba(26,94,168,0.07)" : "rgba(0,188,180,0.06)"}
              stroke={tool === "rect-meta" ? "#b45000" : tool === "rect-header" ? "#1a5ea8" : COLORS.accent}
              strokeWidth={1.5} strokeDasharray="4 2" />
          )}
        </svg>
      )}
    </div>
  );
}
