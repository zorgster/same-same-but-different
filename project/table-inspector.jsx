import { useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";

// ─────────────────────────────────────────────
//  THEME
// ─────────────────────────────────────────────
const COLORS = {
  bg: "#f8f9fb",
  surface: "#fff",
  surface2: "#f3f4f8",
  border: "#e0e3eb",
  border2: "#d3d7e3",
  text: "#222",
  muted: "#7b7e8b",
  accent: "#f0a500",
  green: "#4caf88",
  red: "#e05c5c",
  blue: "#3b82f6",
  purple: "#a259e6",
};
const TYPE_STYLE = {
  numeric: { background: "#eaf4fb", color: COLORS.blue },
  string: { background: "#f3eafd", color: COLORS.purple },
  date: { background: "#eafbf0", color: COLORS.green },
  boolean: { background: "#fff7e0", color: COLORS.accent },
  empty: { background: "#f4f4f4", color: COLORS.muted },
};

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────
const NULL_SET = new Set([
  "",
  "null",
  "none",
  "na",
  "n/a",
  "nan",
  "#n/a",
  "nil",
  "undefined",
  "-",
  "#value!",
  "#ref!",
]);
const isNullVal = (v) =>
  v === null || v === undefined || NULL_SET.has(String(v).trim().toLowerCase());
const trunc = (v, n) => {
  const s = String(v);
  return s.length > n ? s.slice(0, n) + "…" : s;
};
const fmt = (n, dp = 2) => {
  if (n === null || n === undefined || (typeof n === "number" && isNaN(n)))
    return "—";
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toLocaleString(undefined, {
    maximumFractionDigits: dp,
    minimumFractionDigits: 0,
  });
};
function colLetter(n) {
  let s = "";
  n++;
  while (n > 0) {
    s = String.fromCharCode(64 + (n % 26 || 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ─────────────────────────────────────────────
//  TYPE DETECTION
// ─────────────────────────────────────────────
function getType(vals) {
  const nn = vals.filter((v) => !isNullVal(v));
  if (!nn.length) return "empty";
  const bset = new Set(["true", "false", "yes", "no", "0", "1"]);
  if (
    nn.every((v) => bset.has(String(v).trim().toLowerCase())) &&
    new Set(nn.map((v) => String(v).trim().toLowerCase())).size <= 2
  )
    return "boolean";
  const numOk = nn.filter(
    (v) => !isNaN(Number(v)) && String(v).trim() !== "",
  ).length;
  if (numOk / nn.length >= 0.8) return "numeric";
  const dateRe =
    /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/;
  if (nn.filter((v) => dateRe.test(String(v).trim())).length / nn.length >= 0.8)
    return "date";
  return "string";
}

// ─────────────────────────────────────────────
//  BOUNDS
// ─────────────────────────────────────────────
function detectBounds(data) {
  let r1 = -1,
    r2 = -1,
    c1 = Infinity,
    c2 = -1;
  for (let r = 0; r < data.length; r++) {
    const row = data[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (!isNullVal(row[c])) {
        if (r1 === -1) r1 = r;
        r2 = r;
        c1 = Math.min(c1, c);
        c2 = Math.max(c2, c);
      }
    }
  }
  return r1 === -1 ? null : { r1, r2, c1: c1 === Infinity ? 0 : c1, c2 };
}

// ─────────────────────────────────────────────
//  AUTO-DETECT
// ─────────────────────────────────────────────
function autoDetectColNames(data, b) {
  const firstRow = [];
  for (let c = b.c1; c <= b.c2; c++) firstRow.push(data[b.r1]?.[c]);
  const nn = firstRow.filter((v) => !isNullVal(v));
  if (!nn.length) return false;
  const strRatio =
    nn.filter((v) => isNaN(Number(v)) || String(v).trim() === "").length /
    nn.length;
  let numCols = 0;
  for (let c = b.c1; c <= b.c2; c++) {
    const slice = [];
    for (let r = b.r1 + 1; r <= Math.min(b.r2, b.r1 + 30); r++)
      slice.push(data[r]?.[c]);
    if (getType(slice) === "numeric") numCols++;
  }
  const numRatio = b.c2 - b.c1 + 1 > 0 ? numCols / (b.c2 - b.c1 + 1) : 0;
  return strRatio >= 0.5 && (numRatio >= 0.25 || strRatio >= 0.75);
}

function autoDetectRowNames(data, b, hasCol) {
  const sr = hasCol ? b.r1 + 1 : b.r1;
  if (sr > b.r2) return false;
  const firstCol = [];
  for (let r = sr; r <= b.r2; r++) firstCol.push(data[r]?.[b.c1]);
  const nn = firstCol.filter((v) => !isNullVal(v));
  if (!nn.length) return false;
  const nums = nn.map(Number);
  if (
    nums.every((n, i) => !isNaN(n) && (n === i || n === i + 1)) &&
    nn.length > 2
  )
    return true;
  if (getType(firstCol) !== "string") return false;
  let numOther = 0;
  const otherCount = b.c2 - b.c1;
  for (let c = b.c1 + 1; c <= b.c2; c++) {
    const vals = [];
    for (let r = sr; r <= b.r2; r++) vals.push(data[r]?.[c]);
    if (getType(vals) === "numeric") numOther++;
  }
  return otherCount > 0 && numOther / otherCount >= 0.5;
}

// ─────────────────────────────────────────────
//  ANALYSIS  (pure function → useMemo-friendly)
// ─────────────────────────────────────────────
function analyse(data, b, hasCol, hasRow) {
  const dr = hasCol ? b.r1 + 1 : b.r1;
  const dc = hasRow ? b.c1 + 1 : b.c1;

  const colNames = [];
  for (let c = dc; c <= b.c2; c++)
    colNames.push(
      hasCol && !isNullVal(data[b.r1]?.[c])
        ? String(data[b.r1][c])
        : `Col ${c - dc + 1}`,
    );

  const columns = colNames.map((name, ci) => {
    const c = dc + ci;
    const vals = [];
    for (let r = dr; r <= b.r2; r++) vals.push(data[r]?.[c] ?? null);
    const nullCount = vals.filter((v) => isNullVal(v)).length;
    const nn = vals.filter((v) => !isNullVal(v));
    const type = getType(vals);
    const unique = new Set(nn.map(String)).size;
    let min = null,
      max = null,
      mean = null;
    if (type === "numeric" && nn.length) {
      const nums = nn.map(Number);
      min = Math.min(...nums);
      max = Math.max(...nums);
      mean = nums.reduce((a, b) => a + b, 0) / nums.length;
    } else if (nn.length) {
      const sorted = [...nn].sort((a, b) => String(a).localeCompare(String(b)));
      min = String(sorted[0]);
      max = String(sorted[sorted.length - 1]);
    }
    return {
      name,
      type,
      count: vals.length,
      nullCount,
      unique,
      min,
      max,
      mean,
    };
  });

  let emptyRows = 0;
  const emptyRowNums = [];
  for (let r = dr; r <= b.r2; r++) {
    let all = true;
    for (let c = dc; c <= b.c2; c++) {
      if (!isNullVal(data[r]?.[c])) {
        all = false;
        break;
      }
    }
    if (all) {
      emptyRows++;
      emptyRowNums.push(r - dr + 1);
    }
  }
  let emptyCols = 0;
  for (let c = dc; c <= b.c2; c++) {
    let all = true;
    for (let r = dr; r <= b.r2; r++) {
      if (!isNullVal(data[r]?.[c])) {
        all = false;
        break;
      }
    }
    if (all) emptyCols++;
  }

  const totalRows = b.r2 - dr + 1;
  const totalCols = b.c2 - dc + 1;
  const totalCells = totalRows * totalCols;
  const nullCells = columns.reduce((s, c) => s + c.nullCount, 0);
  return {
    columns,
    totalRows,
    totalCols,
    totalCells,
    nullCells,
    emptyRows,
    emptyRowNums,
    emptyCols,
    dr,
    dc,
  };
}

// ─────────────────────────────────────────────
//  SUB-COMPONENTS
// ─────────────────────────────────────────────
const PanelWrap = ({ title, right, children }) => (
  <div
    style={{
      background: COLORS.surface,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 6,
      overflow: "hidden",
    }}
  >
    <div
      style={{
        padding: "8px 14px",
        background: COLORS.surface2,
        borderBottom: `1px solid ${COLORS.border}`,
        display: "flex",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: "'Syne',sans-serif",
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: COLORS.muted,
        }}
      >
        {title}
      </span>
      {right && (
        <span style={{ marginLeft: "auto", fontSize: 11, color: COLORS.muted }}>
          {right}
        </span>
      )}
    </div>
    {children}
  </div>
);

function DetectionPanel({
  bounds: b,
  analysis: a,
  rawData,
  hasColNames,
  hasRowNames,
  detCol,
  detRow,
  setHasColNames,
  setHasRowNames,
}) {
  const rows = b.r2 - b.r1 + 1,
    cols = b.c2 - b.c1 + 1;
  const stats = [
    ["Raw Rows", rows.toLocaleString(), `rows ${b.r1 + 1}–${b.r2 + 1}`],
    [
      "Raw Cols",
      cols.toLocaleString(),
      `cols ${colLetter(b.c1)}–${colLetter(b.c2)}`,
    ],
    ["Data Rows", a.totalRows.toLocaleString(), "after headers"],
    ["Data Cols", a.totalCols.toLocaleString(), "after row names"],
  ];
  return (
    <PanelWrap title="Structure Detection">
      <div style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            gap: 22,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          {stats.map(([label, val, detail]) => (
            <div
              key={label}
              style={{ display: "flex", flexDirection: "column", gap: 1 }}
            >
              <span
                style={{
                  fontSize: 9,
                  color: COLORS.muted,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 600,
                  color: COLORS.accent,
                  lineHeight: 1.1,
                }}
              >
                {val}
              </span>
              <span style={{ fontSize: 10, color: COLORS.muted }}>
                {detail}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{ borderTop: `1px solid ${COLORS.border}`, margin: "12px 0" }}
        />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            {
              label: "Has Column Names",
              sub: "first row is headers",
              checked: hasColNames,
              det: detCol,
              set: setHasColNames,
            },
            {
              label: "Has Row Names",
              sub: "first col is index",
              checked: hasRowNames,
              det: detRow,
              set: setHasRowNames,
            },
          ].map(({ label, sub, checked, det, set }) => {
            const overridden = det !== checked;
            const badgeText = overridden
              ? "OVERRIDDEN"
              : det
                ? "DETECTED"
                : "NOT FOUND";
            const badgeColor = overridden
              ? COLORS.accent
              : det
                ? COLORS.green
                : COLORS.red;
            const badgeBg = overridden
              ? "rgba(232,163,32,.15)"
              : det
                ? "rgba(106,171,120,.18)"
                : "rgba(192,104,104,.15)";
            return (
              <label
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  cursor: "pointer",
                  padding: "7px 11px",
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 5,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => set(e.target.checked)}
                  style={{
                    accentColor: COLORS.accent,
                    width: 14,
                    height: 14,
                    cursor: "pointer",
                  }}
                />
                <div>
                  <div style={{ fontSize: 12 }}>{label}</div>
                  <div
                    style={{ fontSize: 9, color: COLORS.muted, marginTop: 1 }}
                  >
                    {sub}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 9,
                    padding: "1px 5px",
                    borderRadius: 2,
                    fontWeight: 600,
                    letterSpacing: 0.3,
                    background: badgeBg,
                    color: badgeColor,
                    marginLeft: 4,
                  }}
                >
                  {badgeText}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </PanelWrap>
  );
}

function QualityPanel({ analysis: a }) {
  const np = a.totalCells > 0 ? (a.nullCells / a.totalCells) * 100 : 0;
  const rowHint =
    a.emptyRows === 0
      ? "none found"
      : `row${a.emptyRows > 1 ? "s" : ""} ${a.emptyRowNums.slice(0, 6).join(", ")}${a.emptyRowNums.length > 6 ? "…" : ""}`;
  const items = [
    {
      val: `${np.toFixed(1)}%`,
      color: np === 0 ? COLORS.green : np < 5 ? COLORS.accent : COLORS.red,
      label: "Null Rate",
      sub: `${a.nullCells.toLocaleString()} / ${a.totalCells.toLocaleString()} cells`,
    },
    {
      val: a.emptyRows,
      color: a.emptyRows === 0 ? COLORS.green : COLORS.accent,
      label: "Empty Rows",
      sub: rowHint,
    },
    {
      val: a.emptyCols,
      color: a.emptyCols === 0 ? COLORS.green : COLORS.accent,
      label: "Empty Cols",
      sub: a.emptyCols === 0 ? "none found" : `${a.emptyCols} fully null`,
    },
  ];
  return (
    <PanelWrap title="Data Quality">
      <div
        style={{
          padding: 16,
          display: "grid",
          gridTemplateColumns: "repeat(3,1fr)",
          gap: 14,
        }}
      >
        {items.map(({ val, color, label, sub }) => (
          <div
            key={label}
            style={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <span
              style={{ fontSize: 28, fontWeight: 600, lineHeight: 1, color }}
            >
              {val}
            </span>
            <span
              style={{
                fontSize: 9,
                color: COLORS.muted,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginTop: 2,
              }}
            >
              {label}
            </span>
            <span style={{ fontSize: 10, color: COLORS.muted }}>{sub}</span>
          </div>
        ))}
      </div>
    </PanelWrap>
  );
}

function ColumnTable({ analysis: a }) {
  const TH = ({ children, right }) => (
    <th
      style={{
        textAlign: right ? "right" : "left",
        padding: "7px 12px",
        color: COLORS.muted,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        borderBottom: `1px solid ${COLORS.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
  return (
    <PanelWrap title="Column Summary" right={`${a.columns.length} columns`}>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
        >
          <thead>
            <tr>
              <TH>#</TH>
              <TH>Column</TH>
              <TH>Type</TH>
              <TH right>Values</TH>
              <TH>Nulls</TH>
              <TH right>Null %</TH>
              <TH right>Unique</TH>
              <TH>Min / First</TH>
              <TH>Max / Last</TH>
              <TH>Mean</TH>
            </tr>
          </thead>
          <tbody>
            {a.columns.map((col, i) => {
              const np = col.count > 0 ? col.nullCount / col.count : 0;
              const barColor =
                np === 0 ? COLORS.green : np < 0.1 ? COLORS.accent : COLORS.red;
              const pctColor =
                np === 0 ? COLORS.green : np < 0.1 ? COLORS.accent : COLORS.red;
              const tc = TYPE_STYLE[col.type] || TYPE_STYLE.empty;
              const [minS, maxS, meanS] =
                col.type === "numeric"
                  ? [fmt(col.min), fmt(col.max), fmt(col.mean)]
                  : col.min !== null
                    ? [trunc(col.min, 16), trunc(col.max, 16), "—"]
                    : ["—", "—", "—"];
              const TD = ({ children, right, color, fontSize }) => (
                <td
                  style={{
                    padding: "7px 12px",
                    verticalAlign: "middle",
                    whiteSpace: "nowrap",
                    textAlign: right ? "right" : "left",
                    color: color || COLORS.text,
                    fontSize: fontSize || 12,
                  }}
                >
                  {children}
                </td>
              );
              return (
                <tr
                  key={i}
                  style={{ borderBottom: `1px solid ${COLORS.border}` }}
                >
                  <TD color={COLORS.muted} fontSize={10}>
                    {i + 1}
                  </TD>
                  <td
                    style={{
                      padding: "7px 12px",
                      maxWidth: 160,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                    }}
                    title={col.name}
                  >
                    {col.name}
                  </td>
                  <TD>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontWeight: 600,
                        letterSpacing: 0.3,
                        ...tc,
                      }}
                    >
                      {col.type}
                    </span>
                  </TD>
                  <TD right>{(col.count - col.nullCount).toLocaleString()}</TD>
                  <td style={{ padding: "7px 12px", whiteSpace: "nowrap" }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 7 }}
                    >
                      <div
                        style={{
                          width: 52,
                          height: 3,
                          background: COLORS.border2,
                          borderRadius: 2,
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 2,
                            background: barColor,
                            width: `${np > 0 ? Math.max(np * 100, 4) : 0}%`,
                          }}
                        />
                      </div>
                      <span
                        style={{
                          color: COLORS.muted,
                          fontSize: 10,
                          minWidth: 24,
                        }}
                      >
                        {col.nullCount > 0
                          ? col.nullCount.toLocaleString()
                          : "—"}
                      </span>
                    </div>
                  </td>
                  <TD right color={pctColor}>
                    {(np * 100).toFixed(1)}%
                  </TD>
                  <TD right color={COLORS.muted}>
                    {col.unique.toLocaleString()}
                  </TD>
                  <TD color={COLORS.muted} fontSize={11}>
                    {minS}
                  </TD>
                  <TD color={COLORS.muted} fontSize={11}>
                    {maxS}
                  </TD>
                  <TD color={COLORS.blue} fontSize={11}>
                    {meanS}
                  </TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PanelWrap>
  );
}

function PreviewTable({
  rawData,
  bounds: b,
  analysis: a,
  hasColNames,
  hasRowNames,
}) {
  const PREVIEW_ROWS = 25;
  const endRow = Math.min(b.r2, a.dr + PREVIEW_ROWS - 1);
  const shown = endRow - a.dr + 1;
  const idxHead =
    hasColNames && !isNullVal(rawData[b.r1]?.[b.c1])
      ? trunc(String(rawData[b.r1][b.c1]), 12)
      : "Index";

  return (
    <PanelWrap title="Data Preview">
      <div style={{ overflowX: "auto", maxHeight: 300, overflowY: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
        >
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <th
                style={{
                  padding: "6px 10px",
                  color: COLORS.accent,
                  fontSize: 10,
                  textAlign: "left",
                  letterSpacing: 0.5,
                  borderBottom: `1px solid ${COLORS.border2}`,
                  background: COLORS.surface2,
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                }}
              >
                #
              </th>
              {hasRowNames && (
                <th
                  style={{
                    padding: "6px 10px",
                    color: COLORS.muted,
                    fontSize: 10,
                    textAlign: "left",
                    borderBottom: `1px solid ${COLORS.border2}`,
                    background: COLORS.surface2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {idxHead}
                </th>
              )}
              {a.columns.map((col, i) => (
                <th
                  key={i}
                  title={col.name}
                  style={{
                    padding: "6px 10px",
                    color: COLORS.accent,
                    fontSize: 10,
                    textAlign: "left",
                    borderBottom: `1px solid ${COLORS.border2}`,
                    background: COLORS.surface2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {trunc(col.name, 14)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: shown }, (_, ri) => {
              const r = a.dr + ri;
              return (
                <tr
                  key={r}
                  style={{ borderBottom: `1px solid ${COLORS.border}` }}
                >
                  <td
                    style={{
                      padding: "5px 10px",
                      color: COLORS.muted,
                      fontSize: 10,
                      background: COLORS.surface2,
                      position: "sticky",
                      left: 0,
                      borderRight: `1px solid ${COLORS.border}`,
                    }}
                  >
                    {ri + 1}
                  </td>
                  {hasRowNames && (
                    <td
                      style={{
                        padding: "5px 10px",
                        color: COLORS.muted,
                        fontSize: 11,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isNullVal(rawData[r]?.[b.c1]) ? (
                        <span style={{ opacity: 0.4, fontStyle: "italic" }}>
                          ∅
                        </span>
                      ) : (
                        trunc(rawData[r][b.c1], 20)
                      )}
                    </td>
                  )}
                  {a.columns.map((_, ci) => {
                    const v = rawData[r]?.[a.dc + ci];
                    return (
                      <td
                        key={ci}
                        style={{
                          padding: "5px 10px",
                          whiteSpace: "nowrap",
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={v != null ? String(v) : undefined}
                      >
                        {isNullVal(v) ? (
                          <span
                            style={{
                              opacity: 0.4,
                              fontStyle: "italic",
                              color: COLORS.muted,
                            }}
                          >
                            ∅
                          </span>
                        ) : (
                          trunc(v, 22)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        style={{
          padding: "8px 14px",
          color: COLORS.muted,
          fontSize: 11,
          borderTop: `1px solid ${COLORS.border}`,
        }}
      >
        {shown < a.totalRows
          ? `Showing first ${shown} of ${a.totalRows.toLocaleString()} data rows`
          : `All ${a.totalRows.toLocaleString()} data rows shown`}
      </div>
    </PanelWrap>
  );
}

// ─────────────────────────────────────────────
//  DROP ZONE
// ─────────────────────────────────────────────
function DropZone({ onFile, error }) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef();
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
      />
      <div
        onClick={() => fileRef.current.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]);
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "calc(100vh - 57px)",
          gap: 18,
          cursor: "pointer",
          background: dragging ? "rgba(232,163,32,.07)" : "transparent",
          transition: "background .2s",
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            border: `2px dashed ${dragging ? COLORS.accent : COLORS.border2}`,
            borderRadius: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: dragging ? COLORS.accent : COLORS.muted,
            background: dragging ? "rgba(232,163,32,.09)" : "transparent",
            transition: "all .2s",
          }}
        >
          <svg
            width="30"
            height="30"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div
          style={{ textAlign: "center", color: COLORS.muted, lineHeight: 1.9 }}
        >
          <div
            style={{
              color: COLORS.text,
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Drop file here or click to browse
          </div>
          <div>Supports CSV, XLSX and XLS</div>
          <div style={{ fontSize: 11, opacity: 0.6 }}>
            — column types, nulls and structure detected automatically —
          </div>
          {error && (
            <div style={{ color: COLORS.red, marginTop: 10, fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
//  ROOT
// ─────────────────────────────────────────────
export default function TableInspectorApp() {
  const [rawData, setRawData] = useState(null);
  const [bounds, setBounds] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [hasColNames, setHasColNames] = useState(false);
  const [hasRowNames, setHasRowNames] = useState(false);
  const [detCol, setDetCol] = useState(false);
  const [detRow, setDetRow] = useState(false);
  const [error, setError] = useState(null);

  // ← only key state drives a re-analyse; no manual re-render needed
  const analysis = useMemo(
    () =>
      rawData && bounds
        ? analyse(rawData, bounds, hasColNames, hasRowNames)
        : null,
    [rawData, bounds, hasColNames, hasRowNames],
  );

  const handleFile = useCallback((file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    const fmt = ext === "csv" ? "CSV" : "XLSX";
    const info = { name: file.name, size: file.size, fmt };
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let data;
        if (fmt === "CSV") {
          data = Papa.parse(e.target.result, {
            skipEmptyLines: false,
            dynamicTyping: false,
            header: false,
          }).data;
        } else {
          const wb = XLSX.read(new Uint8Array(e.target.result), {
            type: "array",
          });
          data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {
            header: 1,
            defval: null,
            raw: false,
          });
        }
        const b = detectBounds(data);
        if (!b) {
          setError("No data found in this file.");
          return;
        }
        const dc = autoDetectColNames(data, b);
        const dr = autoDetectRowNames(data, b, dc);
        setRawData(data);
        setBounds(b);
        setDetCol(dc);
        setDetRow(dr);
        setHasColNames(dc);
        setHasRowNames(dr);
        setFileInfo(info);
        setError(null);
      } catch (err) {
        setError("Could not parse: " + err.message);
      }
    };
    if (fmt === "CSV") reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }, []);

  const reset = () => {
    setRawData(null);
    setBounds(null);
    setFileInfo(null);
  };

  const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');*{box-sizing:border-box}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:${COLORS.surface}}::-webkit-scrollbar-thumb{background:${COLORS.border2};border-radius:3px}::-webkit-scrollbar-corner{background:${COLORS.surface}}`;

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono',monospace",
        background: COLORS.bg,
        color: COLORS.text,
        minHeight: "100vh",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <style>{FONTS}</style>

      {/* Header */}
      <div
        style={{
          padding: "16px 28px",
          borderBottom: `1px solid ${COLORS.border}`,
          display: "flex",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <span
          style={{
            fontFamily: "'Syne',sans-serif",
            fontSize: 20,
            fontWeight: 800,
            color: COLORS.accent,
            letterSpacing: -0.3,
          }}
        >
          TABLE INSPECTOR
        </span>
        <span style={{ color: COLORS.muted, fontSize: 11 }}>
          {rawData
            ? "structure & quality analysis"
            : "drop a csv or xlsx to analyse"}
        </span>
      </div>

      {!rawData ? (
        <DropZone onFile={handleFile} error={error} />
      ) : (
        <div
          style={{
            padding: "20px 28px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            maxWidth: 1440,
            margin: "0 auto",
          }}
        >
          {/* File bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "8px 14px",
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
            }}
          >
            <span
              style={{
                background: COLORS.accent,
                color: COLORS.bg,
                fontFamily: "'Syne',sans-serif",
                fontWeight: 800,
                fontSize: 10,
                padding: "2px 7px",
                borderRadius: 3,
                letterSpacing: 0.5,
                flexShrink: 0,
              }}
            >
              {fileInfo.fmt}
            </span>
            <span
              style={{
                fontWeight: 600,
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {fileInfo.name}
            </span>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 16,
                color: COLORS.muted,
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              <span>
                {fileInfo.size > 1048576
                  ? `${(fileInfo.size / 1048576).toFixed(1)} MB`
                  : `${(fileInfo.size / 1024).toFixed(1)} KB`}
              </span>
              <span>{rawData.length.toLocaleString()} raw rows</span>
            </div>
            <button
              onClick={reset}
              style={{
                background: "none",
                border: `1px solid ${COLORS.border2}`,
                color: COLORS.muted,
                padding: "3px 9px",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 11,
              }}
            >
              × clear
            </button>
          </div>

          {/* Top row */}
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <DetectionPanel
              bounds={bounds}
              analysis={analysis}
              rawData={rawData}
              hasColNames={hasColNames}
              hasRowNames={hasRowNames}
              detCol={detCol}
              detRow={detRow}
              setHasColNames={setHasColNames}
              setHasRowNames={setHasRowNames}
            />
            <QualityPanel analysis={analysis} />
          </div>

          <ColumnTable analysis={analysis} />

          <PreviewTable
            rawData={rawData}
            bounds={bounds}
            analysis={analysis}
            hasColNames={hasColNames}
            hasRowNames={hasRowNames}
          />
        </div>
      )}
    </div>
  );
}
