import { useState, useCallback } from "react";
import * as XLSX from "xlsx";

const COLORS = {
  bg: "#f8f9fb",
  surface: "#fff",
  border: "#e0e3eb",
  accent: "#f0a500",
  accentDim: "#fff7e0",
  red: "#e05c5c",
  redDim: "#ffeaea",
  green: "#4caf88",
  greenDim: "#e6f7f1",
  text: "#222",
  muted: "#7b7e8b",
};

const styles = {
  app: {
    minHeight: "100vh",
    background: COLORS.bg,
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    color: COLORS.text,
    padding: "32px 24px",
  },
  header: {
    marginBottom: 40,
    borderBottom: `1px solid ${COLORS.border}`,
    paddingBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: 700,
    letterSpacing: "-0.5px",
    margin: 0,
    color: COLORS.text,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 6,
    fontWeight: 400,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    marginBottom: 28,
  },
  dropZone: (active) => ({
    border: `2px dashed ${active ? COLORS.accent : COLORS.border}`,
    borderRadius: 12,
    padding: "28px 20px",
    textAlign: "center",
    cursor: "pointer",
    transition: "all 0.2s",
    background: active ? COLORS.accentDim : COLORS.surface,
    position: "relative",
  }),
  fileLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    color: COLORS.accent,
    marginBottom: 10,
    display: "block",
  },
  dropText: {
    fontSize: 13,
    color: COLORS.muted,
    margin: 0,
  },
  fileName: {
    fontSize: 13,
    fontWeight: 600,
    color: COLORS.text,
    marginTop: 8,
    wordBreak: "break-all",
  },
  fileCount: {
    fontSize: 12,
    color: COLORS.green,
    marginTop: 4,
  },
  colPicker: {
    marginTop: 14,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  colBtn: (selected) => ({
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${selected ? COLORS.accent : COLORS.border}`,
    background: selected ? COLORS.accentDim : "transparent",
    color: selected ? COLORS.accent : COLORS.muted,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  }),
  compareBtn: (disabled) => ({
    width: "100%",
    padding: "14px",
    borderRadius: 10,
    border: "none",
    background: disabled ? COLORS.border : COLORS.accent,
    color: disabled ? COLORS.muted : "#0f1117",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: "0.3px",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 0.2s",
    marginBottom: 32,
  }),
  resultsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
    marginBottom: 20,
  },
  resultCard: (color) => ({
    background: COLORS.surface,
    border: `1px solid ${color}44`,
    borderRadius: 12,
    overflow: "hidden",
  }),
  cardHeader: (color) => ({
    background: `${color}18`,
    borderBottom: `1px solid ${color}33`,
    padding: "12px 16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  }),
  cardTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "1px",
    textTransform: "uppercase",
  },
  badge: (color) => ({
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 8px",
    borderRadius: 20,
    background: `${color}33`,
    color: color,
  }),
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    padding: "8px 16px",
    textAlign: "left",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "1px",
    textTransform: "uppercase",
    color: COLORS.muted,
    borderBottom: `1px solid ${COLORS.border}`,
  },
  td: {
    padding: "9px 16px",
    borderBottom: `1px solid ${COLORS.border}15`,
    fontFamily: "'DM Mono', 'Courier New', monospace",
    fontSize: 12,
  },
  emptyState: {
    padding: "24px",
    textAlign: "center",
    color: COLORS.green,
    fontSize: 13,
  },
  summaryBar: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: "16px 20px",
    display: "flex",
    gap: 24,
    alignItems: "center",
    marginBottom: 20,
    flexWrap: "wrap",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  statVal: {
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  matchBlock: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: "16px 20px",
  },
};

function parseFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function DropZone({ label, onFile, data, nameCol, idCol, onSelectCol }) {
  const [drag, setDrag] = useState(false);
  const [fileName, setFileName] = useState(null);

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setDrag(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      setFileName(file.name);
      const rows = await parseFile(file);
      onFile(rows, file.name);
    },
    [onFile],
  );

  const handleChange = useCallback(
    async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setFileName(file.name);
      const rows = await parseFile(file);
      onFile(rows, file.name);
    },
    [onFile],
  );

  const headers = data ? data[0] : [];
  const rowCount = data ? data.length - 1 : 0;

  return (
    <div
      style={styles.dropZone(drag)}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
    >
      <label style={{ cursor: "pointer", display: "block" }}>
        <span style={styles.fileLabel}>{label}</span>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: "none" }}
          onChange={handleChange}
        />
        {!fileName ? (
          <p style={styles.dropText}>
            Drop your spreadsheet here
            <br />
            <span style={{ fontSize: 11 }}>Excel or CSV · click to browse</span>
          </p>
        ) : (
          <>
            <div style={styles.fileName}>📄 {fileName}</div>
            <div style={styles.fileCount}>✓ {rowCount} students loaded</div>
          </>
        )}
      </label>
      {headers.length > 0 && (
        <div>
          <div
            style={{
              marginTop: 14,
              marginBottom: 6,
              fontSize: 11,
              color: COLORS.muted,
            }}
          >
            Select <b style={{ color: COLORS.accent }}>Name</b> column:
          </div>
          <div style={styles.colPicker}>
            {headers.map((h, i) => (
              <button
                key={i}
                style={styles.colBtn(nameCol === i)}
                onClick={() => onSelectCol("name", i)}
              >
                {String(h || `Col ${i + 1}`)}
              </button>
            ))}
          </div>
          <div
            style={{
              marginTop: 10,
              marginBottom: 6,
              fontSize: 11,
              color: COLORS.muted,
            }}
          >
            Select <b style={{ color: COLORS.accent }}>ID</b> column:
          </div>
          <div style={styles.colPicker}>
            {headers.map((h, i) => (
              <button
                key={i}
                style={styles.colBtn(idCol === i)}
                onClick={() => onSelectCol("id", i)}
              >
                {String(h || `Col ${i + 1}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultTable({ rows, color, emptyMsg }) {
  if (rows.length === 0)
    return <div style={styles.emptyState}>✓ {emptyMsg}</div>;
  return (
    <div style={{ maxHeight: 280, overflowY: "auto" }}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              style={{ background: i % 2 === 0 ? "transparent" : `${color}08` }}
            >
              <td style={styles.td}>{r.name}</td>
              <td style={{ ...styles.td, color }}>{r.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DataCompareApp() {
  const [dataA, setDataA] = useState(null);
  const [dataB, setDataB] = useState(null);
  const [nameA, setNameA] = useState(null);
  const [nameB, setNameB] = useState(null);
  const [idA, setIdA] = useState(null);
  const [idB, setIdB] = useState(null);
  const [results, setResults] = useState(null);

  const handleColA = (type, idx) => {
    if (type === "name") setNameA(idx);
    else setIdA(idx);
  };
  const handleColB = (type, idx) => {
    if (type === "name") setNameB(idx);
    else setIdB(idx);
  };

  const ready =
    dataA &&
    dataB &&
    nameA !== null &&
    idA !== null &&
    nameB !== null &&
    idB !== null;

  const compare = () => {
    const extract = (data, nameCol, idCol) =>
      data
        .slice(1)
        .map((row) => ({
          name: String(row[nameCol] ?? "").trim(),
          id: String(row[idCol] ?? "")
            .trim()
            .toUpperCase(),
        }))
        .filter((r) => r.id);

    const listA = extract(dataA, nameA, idA);
    const listB = extract(dataB, nameB, idB);

    const idsA = new Set(listA.map((r) => r.id));
    const idsB = new Set(listB.map((r) => r.id));

    const missingFromA = listB.filter((r) => !idsA.has(r.id));
    const missingFromB = listA.filter((r) => !idsB.has(r.id));
    const matched = listA.filter((r) => idsB.has(r.id));

    // Name mismatches (same ID, different name)
    const mapA = Object.fromEntries(listA.map((r) => [r.id, r.name]));
    const mapB = Object.fromEntries(listB.map((r) => [r.id, r.name]));
    const nameMismatches = matched
      .filter(
        (r) => mapB[r.id] && mapB[r.id].toLowerCase() !== r.name.toLowerCase(),
      )
      .map((r) => ({ id: r.id, nameInA: r.name, nameInB: mapB[r.id] }));

    setResults({ missingFromA, missingFromB, matched, nameMismatches });
  };

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <h1 style={styles.title}>Name-ID Mismatch Checker</h1>
        <p style={styles.subtitle}>
          Compare Name and ID columns from two datasets to find missing, added,
          and changed values
        </p>
      </div>

      <div style={styles.grid}>
        <DropZone
          label="Spreadsheet A"
          onFile={(rows) => {
            setDataA(rows);
            setResults(null);
          }}
          data={dataA}
          nameCol={nameA}
          idCol={idA}
          onSelectCol={handleColA}
        />
        <DropZone
          label="Spreadsheet B"
          onFile={(rows) => {
            setDataB(rows);
            setResults(null);
          }}
          data={dataB}
          nameCol={nameB}
          idCol={idB}
          onSelectCol={handleColB}
        />
      </div>

      {!ready && (dataA || dataB) && (
        <div
          style={{
            fontSize: 12,
            color: COLORS.muted,
            marginBottom: 16,
            textAlign: "center",
          }}
        >
          Select Name and ID columns for both spreadsheets to continue
        </div>
      )}

      <button
        style={styles.compareBtn(!ready)}
        onClick={compare}
        disabled={!ready}
      >
        {ready ? "Compare Data →" : "Upload & configure both spreadsheets"}
      </button>

      {results && (
        <>
          <div style={styles.summaryBar}>
            <div style={styles.stat}>
              <span style={{ ...styles.statVal, color: COLORS.green }}>
                {results.matched.length}
              </span>
              <span style={styles.statLabel}>Matched</span>
            </div>
            <div style={{ width: 1, height: 36, background: COLORS.border }} />
            <div style={styles.stat}>
              <span style={{ ...styles.statVal, color: COLORS.red }}>
                {results.missingFromA.length}
              </span>
              <span style={styles.statLabel}>Missing from A</span>
            </div>
            <div style={styles.stat}>
              <span style={{ ...styles.statVal, color: COLORS.red }}>
                {results.missingFromB.length}
              </span>
              <span style={styles.statLabel}>Missing from B</span>
            </div>
            {results.nameMismatches.length > 0 && (
              <>
                <div
                  style={{ width: 1, height: 36, background: COLORS.border }}
                />
                <div style={styles.stat}>
                  <span style={{ ...styles.statVal, color: COLORS.accent }}>
                    {results.nameMismatches.length}
                  </span>
                  <span style={styles.statLabel}>Name mismatches</span>
                </div>
              </>
            )}
          </div>

          <div style={styles.resultsGrid}>
            <div style={styles.resultCard(COLORS.red)}>
              <div style={styles.cardHeader(COLORS.red)}>
                <span style={{ ...styles.cardTitle, color: COLORS.red }}>
                  In A, not in B
                </span>
                <span style={styles.badge(COLORS.red)}>
                  {results.missingFromB.length}
                </span>
              </div>
              <ResultTable
                rows={results.missingFromB}
                color={COLORS.red}
                emptyMsg="Spreadsheet B has everyone in A"
              />
            </div>
            <div style={styles.resultCard(COLORS.red)}>
              <div style={styles.cardHeader(COLORS.red)}>
                <span style={{ ...styles.cardTitle, color: COLORS.red }}>
                  In B, not in A
                </span>
                <span style={styles.badge(COLORS.red)}>
                  {results.missingFromA.length}
                </span>
              </div>
              <ResultTable
                rows={results.missingFromA}
                color={COLORS.red}
                emptyMsg="Spreadsheet A has everyone in B"
              />
            </div>
          </div>

          {results.nameMismatches.length > 0 && (
            <div style={styles.matchBlock}>
              <div
                style={{
                  ...styles.cardHeader(COLORS.accent),
                  borderRadius: "8px 8px 0 0",
                  marginBottom: 0,
                  padding: "12px 16px",
                }}
              >
                <span style={{ ...styles.cardTitle, color: COLORS.accent }}>
                  ⚠ Same ID, Different Name
                </span>
              </div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>ID</th>
                    <th style={styles.th}>Name in A</th>
                    <th style={styles.th}>Name in B</th>
                  </tr>
                </thead>
                <tbody>
                  {results.nameMismatches.map((r, i) => (
                    <tr key={i}>
                      <td
                        style={{
                          ...styles.td,
                          color: COLORS.accent,
                          fontFamily: "'DM Mono', monospace",
                        }}
                      >
                        {r.id}
                      </td>
                      <td style={styles.td}>{r.nameInA}</td>
                      <td style={styles.td}>{r.nameInB}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
