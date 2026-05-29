import { useState } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import DropZone from "../widgets/DropZone";
import { COLORS, UI_FONT, MONO_FONT } from "../styles/light-theme";

const DATA_TYPES = ["String", "Number", "Date", "Boolean"];

const DEFAULT_FIELDS = [
  { id: "f1", name: "First Name",      dataType: "String"  },
  { id: "f2", name: "Surname",         dataType: "String"  },
  { id: "f3", name: "Re-Registration", dataType: "Boolean" },
  { id: "f4", name: "PrevRegDate",     dataType: "Date"    },
];

let uid = 5;
const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, "");

export default function DataRequester() {
  const [fields,      setFields]      = useState(DEFAULT_FIELDS);
  const [addingField, setAddingField] = useState(false);
  const [newName,     setNewName]     = useState("");
  const [newType,     setNewType]     = useState("String");

  const [sourceFile, setSourceFile] = useState(null);
  const [source,     setSource]     = useState(null); // { columns: string[], rows: object[] }

  const [mapping,    setMapping]    = useState({}); // fieldId → sourceColName
  const [manual,     setManual]     = useState({}); // fieldId → bool
  const [manualVals, setManualVals] = useState({}); // fieldId → { rowIdx → value }

  const [dragging,   setDragging]   = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // ── File Parsing ────────────────────────────────────────────────────────────

  const handleFileDrop = (files) => {
    const file = files[0];
    if (!file) return;
    setSourceFile(file);

    const onParsed = ({ columns, rows }) => {
      setSource({ columns, rows });
      const newMap = {};
      fields.forEach((f) => {
        const match = columns.find((c) => norm(c) === norm(f.name));
        if (match) newMap[f.id] = match;
      });
      setMapping(newMap);
      setManual({});
      setManualVals({});
    };

    const reader = new FileReader();
    if (file.name.toLowerCase().endsWith(".csv")) {
      reader.onload = (e) => {
        const result = Papa.parse(e.target.result, { header: true, skipEmptyLines: true });
        onParsed({ columns: result.meta.fields ?? [], rows: result.data });
      };
      reader.readAsText(file);
    } else {
      reader.onload = (e) => {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "", cellDates: true });
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        onParsed({ columns, rows });
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // ── Field Management ────────────────────────────────────────────────────────

  const confirmAddField = () => {
    const name = newName.trim();
    if (!name) return;
    setFields((prev) => [...prev, { id: `f${uid++}`, name, dataType: newType }]);
    setNewName("");
    setAddingField(false);
  };

  const removeField = (id) => {
    setFields    ((prev) => prev.filter((f) => f.id !== id));
    setMapping   ((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setManual    ((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setManualVals((prev) => { const n = { ...prev }; delete n[id]; return n; });
  };

  // ── Column Mapping ──────────────────────────────────────────────────────────

  const dropOnField = (fieldId) => {
    if (!dragging) return;
    const newMap = Object.fromEntries(
      Object.entries(mapping).filter(([, v]) => v !== dragging)
    );
    newMap[fieldId] = dragging;
    setMapping(newMap);
    if (manual[fieldId]) setManual((prev) => ({ ...prev, [fieldId]: false }));
    setDragging(null);
    setDragOverId(null);
  };

  const removeMapping = (fieldId) => {
    setMapping((prev) => { const n = { ...prev }; delete n[fieldId]; return n; });
  };

  const toggleManual = (fieldId) => {
    const goingManual = !manual[fieldId];
    setManual((prev) => ({ ...prev, [fieldId]: goingManual }));
    if (goingManual) removeMapping(fieldId);
  };

  const clearManualCol = (fieldId) => {
    setManualVals((prev) => ({ ...prev, [fieldId]: {} }));
  };

  const setManualVal = (fieldId, rowIdx, value) => {
    setManualVals((prev) => ({
      ...prev,
      [fieldId]: { ...(prev[fieldId] ?? {}), [rowIdx]: value },
    }));
  };

  // ── Computed ────────────────────────────────────────────────────────────────

  const mappedSourceCols = new Set(Object.values(mapping));

  const getMappedRows = () => {
    if (!source) return [];
    return source.rows.map((srcRow, rowIdx) => {
      const out = {};
      fields.forEach((f) => {
        if (mapping[f.id] != null) {
          out[f.id] = srcRow[mapping[f.id]] ?? "";
        } else if (manual[f.id]) {
          const vals = manualVals[f.id] ?? {};
          out[f.id] = vals[rowIdx] ?? (f.dataType === "Boolean" ? false : "");
        } else {
          out[f.id] = "";
        }
      });
      return out;
    });
  };

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleExport = () => {
    const rows = getMappedRows().map((row) => {
      const out = {};
      fields.forEach((f) => { out[f.name] = row[f.id]; });
      return out;
    });
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: fields.map((f) => f.name),
      cellDates: true,
    });
    // Apply date display format so Excel shows dates instead of serial numbers
    const dateColIndices = fields
      .map((f, i) => (f.dataType === "Date" ? i : -1))
      .filter((i) => i !== -1);
    if (dateColIndices.length > 0 && ws["!ref"]) {
      const range = XLSX.utils.decode_range(ws["!ref"]);
      dateColIndices.forEach((ci) => {
        for (let ri = range.s.r + 1; ri <= range.e.r; ri++) {
          const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
          if (cell) cell.z = "yyyy-mm-dd";
        }
      });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, "data-export.xlsx");
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const hasSource  = source != null;
  const mappedRows = getMappedRows();

  return (
    <div style={S.page}>
      <h2 style={S.h2}>Data Requester</h2>
      <p style={S.lead}>
        Upload your data file, drag source columns onto the table headers to map them,
        then export a clean spreadsheet.
      </p>

      {/* ── Drop Zone ── */}
      <div style={{ marginBottom: 20 }}>
        <DropZone
          onFilesSelected={handleFileDrop}
          accept={{
            "text/csv": [".csv"],
            "application/vnd.ms-excel": [".xls"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
          }}
          label="Drop a CSV or Excel file here, or click to select"
          multiple={false}
          selectedFiles={sourceFile ? [sourceFile] : []}
        />
      </div>

      {/* ── Source Column Tags ── */}
      {hasSource && (
        <div style={S.colStrip}>
          <span style={S.colStripLabel}>
            Source columns — drag onto a header to map:
          </span>
          <div style={S.tagRow}>
            {source.columns.map((col) => {
              const isMapped = mappedSourceCols.has(col);
              return (
                <div
                  key={col}
                  draggable={!isMapped}
                  onDragStart={() => setDragging(col)}
                  onDragEnd={() => { setDragging(null); setDragOverId(null); }}
                  style={{
                    ...S.srcTag,
                    opacity: isMapped ? 0.38 : dragging === col ? 0.5 : 1,
                    cursor:  isMapped ? "default" : "grab",
                  }}
                  title={isMapped ? "Already mapped" : "Drag to map"}
                >
                  {col}
                  {isMapped && <span style={S.checkMark}>✓</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Main Table ── */}
      <div style={{ overflowX: "auto" }}>
        <table style={S.table}>
          <thead>
            <tr>
              {fields.map((f) => {
                const isOver   = dragOverId === f.id;
                const mapped   = mapping[f.id];
                const isManual = !!manual[f.id];
                return (
                  <th key={f.id} style={S.th}>
                    {/* Name + remove */}
                    <div style={S.thNameRow}>
                      <span style={S.thName}>{f.name}</span>
                      <button
                        style={S.thRemoveBtn}
                        onClick={() => removeField(f.id)}
                        title="Remove field"
                      >
                        ×
                      </button>
                    </div>

                    {/* Type badge */}
                    <div style={{ margin: "5px 0 6px" }}>
                      <TypeBadge type={f.dataType} />
                    </div>

                    {/* Drop zone / manual indicator */}
                    {isManual ? (
                      <div style={S.manualTag}>✏ manual</div>
                    ) : (
                      <div
                        style={S.dropTarget(isOver, !!mapped)}
                        onDragOver={(e) => { e.preventDefault(); setDragOverId(f.id); }}
                        onDragLeave={() => setDragOverId(null)}
                        onDrop={() => dropOnField(f.id)}
                      >
                        {mapped ? (
                          <>
                            <span style={{ fontFamily: MONO_FONT, fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {mapped}
                            </span>
                            <button style={S.xBtn} onClick={() => removeMapping(f.id)} title="Remove">×</button>
                          </>
                        ) : (
                          <span style={{ color: COLORS.muted, fontSize: 11, fontStyle: "italic" }}>
                            {isOver ? "release" : hasSource ? "drop here" : "—"}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Manual entry toggle (only after file upload) */}
                    {hasSource && (
                      <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button
                          style={isManual ? S.btnActiveXS : S.btnSecondaryXS}
                          onClick={() => toggleManual(f.id)}
                        >
                          {isManual ? "use mapping" : "manual"}
                        </button>
                        {isManual && (
                          <button style={S.btnGhostXS} onClick={() => clearManualCol(f.id)}>
                            clear
                          </button>
                        )}
                      </div>
                    )}
                  </th>
                );
              })}

              {/* ── Add Field column ── */}
              <th style={{ ...S.th, width: addingField ? 180 : 48, verticalAlign: "top", transition: "width 0.15s" }}>
                {addingField ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <input
                      autoFocus
                      style={{ ...S.input, fontSize: 12, padding: "4px 7px" }}
                      placeholder="Field name…"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmAddField();
                        if (e.key === "Escape") { setAddingField(false); setNewName(""); }
                      }}
                    />
                    <select
                      style={{ ...S.select, fontSize: 12, padding: "4px 7px" }}
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                    >
                      {DATA_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button style={S.btnPrimaryXS} onClick={confirmAddField}>Add</button>
                      <button style={S.btnSecondaryXS} onClick={() => { setAddingField(false); setNewName(""); }}>
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <button style={S.addColBtn} onClick={() => setAddingField(true)} title="Add field">
                    +
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {hasSource && mappedRows.length > 0 ? (
              mappedRows.map((row, rowIdx) => (
                <tr key={rowIdx} style={{ background: rowIdx % 2 === 0 ? "#fff" : COLORS.bg }}>
                  {fields.map((f) => (
                    <td key={f.id} style={S.td}>
                      <DataCell
                        field={f}
                        value={row[f.id]}
                        rowIdx={rowIdx}
                        isManual={!!manual[f.id]}
                        manualVals={manualVals}
                        setManualVal={setManualVal}
                      />
                    </td>
                  ))}
                  <td style={S.td} />
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={fields.length + 1} style={S.emptyCell}>
                  {hasSource
                    ? "Map at least one column above to preview data here."
                    : "Upload a file above to populate rows, or use manual entry."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Export ── */}
      {hasSource && mappedRows.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button style={S.btnExport} onClick={handleExport}>
            Export to Excel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function fmtDate(v) {
  if (v == null || v === "") return "";
  let d;
  if (v instanceof Date) {
    d = v;
  } else if (typeof v === "number") {
    d = new Date((v - 25569) * 86400 * 1000);
  } else {
    return String(v);
  }
  return isNaN(d) ? String(v) : d.toISOString().slice(0, 10);
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function TypeBadge({ type }) {
  const palette = {
    String:  { bg: "#dbeafe", color: "#1e40af" },
    Number:  { bg: "#d1fae5", color: "#065f46" },
    Date:    { bg: "#ede9fe", color: "#4c1d95" },
    Boolean: { bg: "#fee2e2", color: "#991b1b" },
  };
  const c = palette[type] ?? palette.String;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 10,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.04em",
      background: c.bg,
      color: c.color,
    }}>
      {type}
    </span>
  );
}

function DataCell({ field, value, rowIdx, isManual, manualVals, setManualVal }) {
  if (field.dataType === "Boolean") {
    const raw     = isManual ? (manualVals[field.id]?.[rowIdx] ?? false) : value;
    const checked = raw === true || raw === "true" || raw === "TRUE" || raw === 1 || raw === "1" || raw === "Yes";
    return (
      <div style={{ display: "flex", justifyContent: "center" }}>
        <input
          type="checkbox"
          checked={!!checked}
          onChange={isManual ? (e) => setManualVal(field.id, rowIdx, e.target.checked) : undefined}
          readOnly={!isManual}
          style={{ width: 16, height: 16, cursor: isManual ? "pointer" : "default" }}
        />
      </div>
    );
  }
  if (isManual) {
    return (
      <input
        type={field.dataType === "Date" ? "date" : field.dataType === "Number" ? "number" : "text"}
        value={manualVals[field.id]?.[rowIdx] ?? ""}
        onChange={(e) => setManualVal(field.id, rowIdx, e.target.value)}
        style={{
          padding: "3px 7px",
          border: "1px solid #f59e0b",
          borderRadius: 4,
          fontFamily: UI_FONT,
          fontSize: 13,
          width: "100%",
          boxSizing: "border-box",
          background: "#fffbeb",
        }}
      />
    );
  }
  if (field.dataType === "Date") {
    return <span style={{ fontFamily: MONO_FONT }}>{fmtDate(value)}</span>;
  }
  return (
    <span style={{ fontFamily: field.dataType === "Number" ? MONO_FONT : UI_FONT }}>
      {value == null || value === "" ? "" : String(value)}
    </span>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────────

const S = {
  page: {
    fontFamily: UI_FONT,
    maxWidth: 1200,
    margin: "0 auto",
    padding: "28px 28px 60px",
    color: COLORS.text,
  },
  h2: {
    fontSize: 24,
    fontWeight: 700,
    margin: "0 0 6px",
    color: COLORS.accent,
  },
  lead: {
    fontSize: 14,
    color: COLORS.muted,
    margin: "0 0 20px",
    lineHeight: 1.6,
  },
  colStrip: {
    marginBottom: 16,
    padding: "10px 14px",
    background: COLORS.bg,
    borderRadius: 8,
    border: `1px solid ${COLORS.border}`,
  },
  colStripLabel: {
    display: "block",
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: 600,
    marginBottom: 8,
  },
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 7,
  },
  srcTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "3px 10px",
    borderRadius: 12,
    fontSize: 12,
    fontFamily: MONO_FONT,
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    userSelect: "none",
    transition: "opacity 0.1s",
  },
  checkMark: {
    color: COLORS.success,
    fontSize: 10,
    fontFamily: UI_FONT,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    background: COLORS.bg,
    padding: "10px 12px",
    textAlign: "left",
    borderBottom: `2px solid ${COLORS.border}`,
    borderRight: `1px solid ${COLORS.border}`,
    verticalAlign: "top",
    minWidth: 150,
  },
  td: {
    padding: "7px 12px",
    borderBottom: `1px solid ${COLORS.border}`,
    borderRight: `1px solid ${COLORS.border}`,
    verticalAlign: "middle",
  },
  thNameRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 4,
    marginBottom: 2,
  },
  thName: {
    fontWeight: 700,
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 1.3,
  },
  thRemoveBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: COLORS.muted,
    fontSize: 16,
    lineHeight: 1,
    padding: "0 2px",
    flexShrink: 0,
  },
  dropTarget: (isOver, hasMapped) => ({
    display: "flex",
    alignItems: "center",
    gap: 4,
    minHeight: 28,
    padding: "3px 8px",
    border: `1.5px dashed ${isOver ? COLORS.accent : hasMapped ? COLORS.success : COLORS.border}`,
    borderRadius: 5,
    background: isOver ? COLORS.accentSoft : hasMapped ? "#f0fdf4" : "transparent",
    transition: "border-color 0.12s, background 0.12s",
    overflow: "hidden",
  }),
  xBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: COLORS.muted,
    fontSize: 16,
    lineHeight: 1,
    padding: "0 1px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
  },
  manualTag: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 10px",
    borderRadius: 5,
    fontSize: 11,
    background: "#fef3c7",
    border: "1px solid #f59e0b",
    color: "#92400e",
    fontWeight: 600,
  },
  addColBtn: {
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: COLORS.surface,
    border: `1.5px dashed ${COLORS.border}`,
    borderRadius: 6,
    cursor: "pointer",
    color: COLORS.muted,
    fontSize: 20,
    fontWeight: 300,
    transition: "border-color 0.12s, color 0.12s",
  },
  emptyCell: {
    padding: "40px 20px",
    textAlign: "center",
    color: COLORS.muted,
    fontSize: 13,
    fontStyle: "italic",
    borderBottom: `1px solid ${COLORS.border}`,
  },
  input: {
    padding: "6px 10px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 5,
    fontFamily: UI_FONT,
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
  },
  select: {
    padding: "6px 10px",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 5,
    fontFamily: UI_FONT,
    fontSize: 13,
    background: "#fff",
    width: "100%",
    cursor: "pointer",
  },
  btnPrimaryXS: {
    padding: "4px 10px",
    background: COLORS.accent,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: UI_FONT,
    fontSize: 12,
    fontWeight: 600,
  },
  btnSecondaryXS: {
    padding: "3px 9px",
    background: COLORS.bg,
    color: COLORS.text,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: UI_FONT,
    fontSize: 11,
  },
  btnActiveXS: {
    padding: "3px 9px",
    background: "#fef3c7",
    color: "#92400e",
    border: "1px solid #f59e0b",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: UI_FONT,
    fontSize: 11,
    fontWeight: 600,
  },
  btnGhostXS: {
    padding: "3px 9px",
    background: "transparent",
    color: COLORS.muted,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: UI_FONT,
    fontSize: 11,
  },
  btnExport: {
    padding: "10px 26px",
    background: COLORS.accent,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: UI_FONT,
    fontSize: 15,
    fontWeight: 700,
  },
};
