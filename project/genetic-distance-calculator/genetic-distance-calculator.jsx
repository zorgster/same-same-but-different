import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import matMapUrl from "./data/maps.mat.tsv?url";
import patMapUrl from "./data/maps.pat.tsv?url";

const CARD_STYLE = {
  maxWidth: 1200,
  margin: "20px auto",
  padding: 20,
  border: "1px solid #dbe3ea",
  borderRadius: 14,
  background: "#ffffff",
};

const GRID_STYLE = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  alignItems: "end",
};

const PAGE_GRID_STYLE = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "minmax(0, 2fr) minmax(260px, 1fr)",
  alignItems: "start",
};

const INFO_PANEL_STYLE = {
  border: "1px solid #dbe3ea",
  borderRadius: 12,
  background: "#f8fafc",
  padding: 14,
};

const CALCULATE_BUTTON_STYLE = {
  appearance: "none",
  border: "1px solid #15803d",
  borderRadius: 10,
  background: "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)",
  color: "#ffffff",
  fontSize: 14,
  fontWeight: 800,
  padding: "10px 16px",
  boxShadow: "0 2px 0 rgba(15, 118, 110, 0.18)",
  cursor: "pointer",
};

const DROPZONE_STYLE = {
  border: "1px dashed #9fb6cf",
  borderRadius: 10,
  background: "#f7fbff",
  padding: "10px 12px",
  marginBottom: 14,
  display: "flex",
  gap: 10,
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
};

const TABLE_CONTAINER_STYLE = {
  marginTop: 16,
  border: "1px solid #dae4ee",
  borderRadius: 10,
  overflow: "auto",
  background: "#ffffff",
};

const TABLE_PAGER_STYLE = {
  marginTop: 10,
  display: "flex",
  gap: 10,
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
};

const TABLE_PAGER_BUTTON_STYLE = {
  ...CALCULATE_BUTTON_STYLE,
  padding: "7px 12px",
  fontSize: 12,
};

const CM_DELTA_ALERT_THRESHOLD = 0.1;
const MAT_PAT_IMBALANCE_THRESHOLD = 0.15;

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toOptionalNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return toNumber(text);
}

function formatCellDecimal(value, decimals = 4) {
  const numeric = toNumber(String(value ?? "").replace(/,/g, ""));
  if (numeric === null) return String(value ?? "");
  return numeric.toFixed(decimals);
}

function chromosomeSortValue(raw) {
  const text = String(raw || "").trim().toLowerCase();
  const clean = text.startsWith("chr") ? text.slice(3) : text;

  if (/^\d+$/.test(clean)) return Number(clean);
  if (clean === "x") return 23;
  if (clean === "y") return 24;
  if (clean === "m" || clean === "mt") return 25;
  return Number.MAX_SAFE_INTEGER;
}

function normalizeChromosomeText(value) {
  return String(value || "").trim().toLowerCase();
}

function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function parseDelimitedLine(line, delimiter) {
  const out = [];
  let curr = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        curr += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(curr);
      curr = "";
      continue;
    }
    curr += ch;
  }

  out.push(curr);
  return out;
}

async function parseTabularFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const isExcel = /\.(xlsx|xls)$/i.test(name);

  if (isExcel) {
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { headers: [], rows: [] };
    const worksheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    if (!matrix.length) return { headers: [], rows: [] };

    const headers = (matrix[0] || []).map((v, idx) => {
      const text = String(v || "").trim();
      return text || `Column ${idx + 1}`;
    });

    const rows = matrix.slice(1).map((row) =>
      headers.reduce((acc, header, idx) => {
        acc[header] = String(row?.[idx] ?? "").trim();
        return acc;
      }, {})
    );

    return { headers, rows };
  }

  const text = await file.text();
  const lines = String(text)
    .split(/\r?\n/)
    .filter((line) => String(line).trim().length > 0);

  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = parseDelimitedLine(lines[0], delimiter);
  const headers = rawHeaders.map((v, idx) => {
    const textVal = String(v || "").trim();
    return textVal || `Column ${idx + 1}`;
  });

  const rows = lines.slice(1).map((line) => {
    const cols = parseDelimitedLine(line, delimiter);
    return headers.reduce((acc, header, idx) => {
      acc[header] = String(cols?.[idx] ?? "").trim();
      return acc;
    }, {});
  });

  return { headers, rows };
}

function resolveChromosomeKey(rawChr, map) {
  const base = String(rawChr || "").trim();
  if (!base) return "";

  if (map.has(base)) return base;

  const lower = base.toLowerCase();
  const withChr = lower.startsWith("chr") ? lower : `chr${lower}`;

  for (const key of map.keys()) {
    const normKey = String(key || "").toLowerCase();
    if (normKey === lower || normKey === withChr) return key;
  }

  return "";
}

function parseMapTsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (!lines.length) return new Map();

  const header = lines[0].split("\t");
  const findColumn = (name) => header.findIndex((col) => String(col).toLowerCase() === name.toLowerCase());

  const chrIdx = findColumn("Chr");
  const posIdx = findColumn("pos");
  const cmRateIdx = findColumn("cMperMb");

  if (chrIdx === -1 || posIdx === -1 || cmRateIdx === -1) {
    throw new Error("TSV missing required columns (Chr, pos, cMperMb).");
  }

  const byChromosome = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split("\t");
    const chr = String(cols[chrIdx] || "").trim();
    const pos = toNumber(cols[posIdx]);
    const cMperMb = toNumber(cols[cmRateIdx]);

    if (!chr || pos === null || cMperMb === null) continue;

    if (!byChromosome.has(chr)) byChromosome.set(chr, []);
    byChromosome.get(chr).push({ pos, cMperMb });
  }

  for (const [chr, rows] of byChromosome.entries()) {
    rows.sort((a, b) => a.pos - b.pos);
    byChromosome.set(chr, buildIntervals(rows));
  }

  return byChromosome;
}

function buildIntervals(rows) {
  if (!rows.length) return [];

  if (rows.length === 1) {
    const center = rows[0].pos;
    return [{ start: Math.max(0, center - 500000), end: center + 500000, cMperMb: rows[0].cMperMb }];
  }

  const intervals = [];
  for (let i = 0; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const next = rows[i + 1];

    const leftBoundary = i === 0
      ? Math.max(0, curr.pos - (next.pos - curr.pos) / 2)
      : (prev.pos + curr.pos) / 2;

    const rightBoundary = i === rows.length - 1
      ? curr.pos + (curr.pos - prev.pos) / 2
      : (curr.pos + next.pos) / 2;

    intervals.push({
      start: leftBoundary,
      end: rightBoundary,
      cMperMb: curr.cMperMb,
    });
  }

  return intervals;
}

function calculateSegmentCm(intervals, start, end) {
  if (!intervals.length) return 0;

  const segmentStart = Math.min(start, end);
  const segmentEnd = Math.max(start, end);
  if (segmentEnd <= segmentStart) return 0;

  let cm = 0;
  for (const interval of intervals) {
    const overlapStart = Math.max(segmentStart, interval.start);
    const overlapEnd = Math.min(segmentEnd, interval.end);
    if (overlapEnd <= overlapStart) continue;

    const overlapBp = overlapEnd - overlapStart;
    cm += (overlapBp / 1e6) * interval.cMperMb;
  }

  return cm;
}

async function loadText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load map data (${response.status}).`);
  }
  return response.text();
}

export default function GeneticDistanceCalculatorApp() {
  const [maps, setMaps] = useState({ mat: new Map(), pat: new Map() });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [chromosome, setChromosome] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState(null);
  const [formError, setFormError] = useState("");
  const [mode, setMode] = useState("manual");
  const [tableFileName, setTableFileName] = useState("");
  const [tableHeaders, setTableHeaders] = useState([]);
  const [tableRows, setTableRows] = useState([]);
  const [tableError, setTableError] = useState("");
  const [columnMap, setColumnMap] = useState({ name: "", snps: "", chr: "", start: "", end: "", existingCm: "" });
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);
  const [tableFilters, setTableFilters] = useState({ chr: "", startMb: "", endMb: "" });
  const [tableSort, setTableSort] = useState({ key: "chr", dir: "asc" });

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setLoadError("");

      try {
        const [matText, patText] = await Promise.all([loadText(matMapUrl), loadText(patMapUrl)]);
        if (!active) return;

        setMaps({
          mat: parseMapTsv(matText),
          pat: parseMapTsv(patText),
        });
      } catch (error) {
        if (!active) return;
        setLoadError(String(error?.message || "Failed to load genetic maps."));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const chromosomeOptions = useMemo(() => {
    const list = Array.from(new Set([...maps.mat.keys(), ...maps.pat.keys()]));
    return list.sort((a, b) => {
      const ax = a.replace(/^chr/i, "");
      const bx = b.replace(/^chr/i, "");
      const an = Number(ax);
      const bn = Number(bx);

      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return ax.localeCompare(bx);
    });
  }, [maps]);

  useEffect(() => {
    if (!chromosomeOptions.length) {
      setChromosome("");
      return;
    }

    if (!chromosomeOptions.includes(chromosome)) {
      setChromosome(chromosomeOptions[0]);
    }
  }, [chromosomeOptions, chromosome]);

  useEffect(() => {
    const normalizedHeaders = tableHeaders.map((header) => String(header || "").toLowerCase());

    const pick = (patterns) => {
      const foundIndex = normalizedHeaders.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
      return foundIndex >= 0 ? tableHeaders[foundIndex] : "";
    };

    const pickAdjacent = (anchorIndex, offset) => {
      const targetIndex = anchorIndex + offset;
      return targetIndex >= 0 && targetIndex < tableHeaders.length ? tableHeaders[targetIndex] : "";
    };

    const chrIndex = normalizedHeaders.findIndex((header) => /^chr$/.test(header) || /^chrom$/.test(header) || /^chromosome/.test(header));

    if (!tableHeaders.length) {
      setColumnMap({ name: "", snps: "", chr: "", start: "", end: "", existingCm: "" });
      return;
    }

    const inferredChr = pick([/^chr$/, /\bchrom\b/, /chromosome/]);
    const inferredStart = pick([/^start$/, /start[_\s-]?pos/, /^from$/]) || (chrIndex >= 0 ? pickAdjacent(chrIndex, 1) : "");
    const inferredEnd = pick([/^end$/, /end[_\s-]?pos/, /^to$/]) || (chrIndex >= 0 ? pickAdjacent(chrIndex, 2) : "");

    setColumnMap({
      name:
        pick([/^match[_\s-]?name$/]) ||
        pick([/^display[_\s-]?name$/]) ||
        pick([/^full[_\s-]?name$/]) ||
        pick([/^name$/]) ||
        pick([/person|sample/]),
      snps: pick([/#?snps?/, /snp[_\s-]?count/, /total[_\s-]?snps?/]),
      chr: inferredChr,
      start: inferredStart,
      end: inferredEnd,
      existingCm: pick([/\bcm\b/, /centimorgan/, /genetic[_\s-]?distance/]),
    });
  }, [tableHeaders]);

  function onCalculate(event) {
    event.preventDefault();
    setFormError("");

    const startBp = toNumber(start);
    const endBp = toNumber(end);

    if (!chromosome) {
      setFormError("Select a chromosome.");
      return;
    }

    if (startBp === null || endBp === null || startBp < 0 || endBp < 0) {
      setFormError("Start and end must be valid non-negative base-pair positions.");
      return;
    }

    const matIntervals = maps.mat.get(chromosome) || [];
    const patIntervals = maps.pat.get(chromosome) || [];

    if (!matIntervals.length && !patIntervals.length) {
      setFormError("No map data found for the selected chromosome.");
      return;
    }

    const maternalCm = matIntervals.length ? calculateSegmentCm(matIntervals, startBp, endBp) : null;
    const paternalCm = patIntervals.length ? calculateSegmentCm(patIntervals, startBp, endBp) : null;
    const averagedCm = maternalCm !== null && paternalCm !== null ? (maternalCm + paternalCm) / 2 : maternalCm ?? paternalCm;

    setResult({
      chromosome,
      start: Math.min(startBp, endBp),
      end: Math.max(startBp, endBp),
      lengthMb: (Math.max(startBp, endBp) - Math.min(startBp, endBp)) / 1e6,
      maternalCm,
      paternalCm,
      averagedCm,
    });
  }

  async function onFileSelected(file) {
    if (!file) return;
    setTableError("");

    try {
      const parsed = await parseTabularFile(file);
      if (!parsed.headers.length || !parsed.rows.length) {
        setTableError("The uploaded file did not contain tabular rows with a header.");
        return;
      }

      setTableFileName(file.name || "Uploaded file");
      setTableHeaders(parsed.headers);
      setTableRows(parsed.rows);
      setMode("table");
      setTablePage(1);
      setTableFilters({ chr: "", startMb: "", endMb: "" });
    } catch (error) {
      setTableError(String(error?.message || "Could not parse uploaded file."));
    }
  }

  function resetToManual() {
    setMode("manual");
    setTableError("");
  }

  const tableComputedRows = useMemo(() => {
    if (mode !== "table") return [];

    return tableRows.map((row) => {
      const nameRaw = columnMap.name ? row[columnMap.name] : "";
      const snpsRaw = columnMap.snps ? row[columnMap.snps] : "";
      const chrRaw = row[columnMap.chr];
      const startRaw = row[columnMap.start];
      const endRaw = row[columnMap.end];
      const existingRaw = columnMap.existingCm ? row[columnMap.existingCm] : "";

      const startBp = toNumber(String(startRaw || "").replace(/,/g, ""));
      const endBp = toNumber(String(endRaw || "").replace(/,/g, ""));
      const matKey = resolveChromosomeKey(chrRaw, maps.mat);
      const patKey = resolveChromosomeKey(chrRaw, maps.pat);

      let maternalCm = null;
      let paternalCm = null;
      let averagedCm = null;

      if (startBp !== null && endBp !== null && startBp >= 0 && endBp >= 0) {
        const matIntervals = matKey ? maps.mat.get(matKey) || [] : [];
        const patIntervals = patKey ? maps.pat.get(patKey) || [] : [];
        maternalCm = matIntervals.length ? calculateSegmentCm(matIntervals, startBp, endBp) : null;
        paternalCm = patIntervals.length ? calculateSegmentCm(patIntervals, startBp, endBp) : null;
        averagedCm = maternalCm !== null && paternalCm !== null ? (maternalCm + paternalCm) / 2 : maternalCm ?? paternalCm;
      }

      return {
        name: String(nameRaw || ""),
        snps: String(snpsRaw || ""),
        chr: String(chrRaw || ""),
        start: String(startRaw || ""),
        end: String(endRaw || ""),
        existingCm: formatCellDecimal(existingRaw, 4),
        maternalCm,
        paternalCm,
        averagedCm,
      };
    });
  }, [mode, columnMap, tableRows, maps]);

  const tableChromosomeOptions = useMemo(() => {
    const unique = new Set();

    for (const row of tableComputedRows) {
      const value = String(row.chr || "").trim();
      if (value) unique.add(value);
    }

    return Array.from(unique).sort((a, b) => {
      const av = chromosomeSortValue(a);
      const bv = chromosomeSortValue(b);
      if (av !== bv) return av - bv;
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    });
  }, [tableComputedRows]);

  useEffect(() => {
    if (!tableFilters.chr) return;

    const selected = normalizeChromosomeText(tableFilters.chr);
    const stillExists = tableChromosomeOptions.some((option) => normalizeChromosomeText(option) === selected);
    if (!stillExists) {
      setTableFilters((prev) => ({ ...prev, chr: "" }));
    }
  }, [tableChromosomeOptions, tableFilters.chr]);

  const filteredSortedRows = useMemo(() => {
    const chrFilter = normalizeChromosomeText(tableFilters.chr);
    const startMinMb = toOptionalNumber(tableFilters.startMb);
    const endMaxMb = toOptionalNumber(tableFilters.endMb);
    const startMinBp = startMinMb !== null ? startMinMb * 1e6 : null;
    const endMaxBp = endMaxMb !== null ? endMaxMb * 1e6 : null;

    const filtered = tableComputedRows.filter((row) => {
      const chrText = normalizeChromosomeText(row.chr);
      const startBp = toNumber(String(row.start || "").replace(/,/g, ""));
      const endBp = toNumber(String(row.end || "").replace(/,/g, ""));

      if (chrFilter && chrText !== chrFilter) return false;
      if (startMinBp !== null && (startBp === null || startBp < startMinBp)) return false;
      if (endMaxBp !== null && (endBp === null || endBp > endMaxBp)) return false;

      return true;
    });

    const dirFactor = tableSort.dir === "desc" ? -1 : 1;
    const sorted = [...filtered].sort((a, b) => {
      if (tableSort.key === "chr") {
        const av = chromosomeSortValue(a.chr);
        const bv = chromosomeSortValue(b.chr);
        if (av !== bv) return (av - bv) * dirFactor;
        return String(a.chr || "").localeCompare(String(b.chr || "")) * dirFactor;
      }

      if (tableSort.key === "start" || tableSort.key === "end") {
        const av = toNumber(String(a[tableSort.key] || "").replace(/,/g, ""));
        const bv = toNumber(String(b[tableSort.key] || "").replace(/,/g, ""));
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av - bv) * dirFactor;
      }

      return 0;
    });

    return sorted;
  }, [tableComputedRows, tableFilters, tableSort]);

  const totalTableRows = filteredSortedRows.length;
  const totalTablePages = Math.max(1, Math.ceil(totalTableRows / tablePageSize));
  const safeTablePage = Math.min(Math.max(tablePage, 1), totalTablePages);
  const pagedTableRows = useMemo(() => {
    const startIndex = (safeTablePage - 1) * tablePageSize;
    return filteredSortedRows.slice(startIndex, startIndex + tablePageSize);
  }, [safeTablePage, tablePageSize, filteredSortedRows]);

  useEffect(() => {
    if (mode !== "table") {
      setTablePage(1);
      return;
    }

    setTablePage((currentPage) => {
      const nextPage = Math.max(1, Math.min(currentPage, totalTablePages));
      return nextPage;
    });
  }, [mode, totalTablePages]);

  useEffect(() => {
    if (mode === "table") setTablePage(1);
  }, [mode, tableFilters, tableSort, tablePageSize]);

  function toggleTableSort(key) {
    setTableSort((prev) => {
      if (prev.key === key) {
        return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key, dir: "asc" };
    });
  }

  function sortLabel(key, label) {
    if (tableSort.key !== key) return label;
    return `${label} ${tableSort.dir === "asc" ? "↑" : "↓"}`;
  }

  return (
    <section style={CARD_STYLE}>
      <h2 style={{ marginTop: 0, marginBottom: 8 }}>Genetic Distance Calculator</h2>
      <p style={{ marginTop: 0, marginBottom: 14, color: "#4f5f73" }}>
        Calculate the genetic distance in centimorgans (cM) across DNA segments using recombination maps.
        Enter a chromosome and start/end positions manually, or drop a table file (for example, '23andMe relatives download') to map columns and calculate cM for multiple segments at once.
      </p>
      <div
        style={DROPZONE_STYLE}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onFileSelected(event.dataTransfer?.files?.[0]);
        }}
      >
        <div style={{ fontSize: 13, color: "#4f5f73" }}>
          Drop CSV, TXT, TSV, XLSX, or XLS here to switch to table mode and map columns.
          {tableFileName ? <strong style={{ marginLeft: 8 }}>Loaded: {tableFileName}</strong> : null}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xls"
            onChange={(event) => onFileSelected(event.target.files?.[0])}
          />
          {mode === "table" ? (
            <button type="button" onClick={resetToManual} style={{ ...CALCULATE_BUTTON_STYLE, padding: "7px 12px", fontSize: 12 }}>
              Show Manual Calculator
            </button>
          ) : tableRows.length ? (
            <button type="button" onClick={() => setMode("table")} style={{ ...CALCULATE_BUTTON_STYLE, padding: "7px 12px", fontSize: 12 }}>
              Show Table Workflow
            </button>
          ) : null}
        </div>
      </div>
      {tableError ? <div style={{ color: "#b10020", marginBottom: 10 }}>{tableError}</div> : null}

      <div style={mode === "table" ? { display: "block" } : PAGE_GRID_STYLE}>
        <div>
          {loading ? <div>Loading recombination maps...</div> : null}
          {loadError ? <div style={{ color: "#b10020" }}>{loadError}</div> : null}

          {!loading && !loadError && mode === "manual" ? (
            <form onSubmit={onCalculate}>
              <div style={GRID_STYLE}>
                <label>
                  Chromosome
                  <select
                    value={chromosome}
                    onChange={(e) => setChromosome(e.target.value)}
                    style={{ display: "block", width: "100%", marginTop: 6 }}
                  >
                    {chromosomeOptions.map((chr) => (
                      <option key={chr} value={chr}>{chr}</option>
                    ))}
                  </select>
                </label>

                <label>
                  Start (bp)
                  <input
                    type="number"
                    min="0"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    style={{ display: "block", width: "100%", marginTop: 6 }}
                    required
                  />
                </label>

                <label>
                  End (bp)
                  <input
                    type="number"
                    min="0"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    style={{ display: "block", width: "100%", marginTop: 6 }}
                    required
                  />
                </label>
              </div>

              <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="submit" style={CALCULATE_BUTTON_STYLE}>
                  Calculate cM
                </button>
                {formError ? <span style={{ color: "#b10020" }}>{formError}</span> : null}
              </div>
            </form>
          ) : null}

          {!loading && !loadError && mode === "table" ? (
            <div>
              <div style={{ ...INFO_PANEL_STYLE, background: "#ffffff", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#64748b", marginBottom: 8 }}>
                  Column Mapping
                </div>
                <div style={GRID_STYLE}>
                  <label>
                    Name column (optional)
                    <select value={columnMap.name} onChange={(e) => setColumnMap((prev) => ({ ...prev, name: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 6 }}>
                      <option value="">None</option>
                      {tableHeaders.map((h) => <option key={`name-${h}`} value={h}>{h}</option>)}
                    </select>
                  </label>
                  <label>
                    #SNPs column (optional)
                    <select value={columnMap.snps} onChange={(e) => setColumnMap((prev) => ({ ...prev, snps: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 6 }}>
                      <option value="">None</option>
                      {tableHeaders.map((h) => <option key={`snps-${h}`} value={h}>{h}</option>)}
                    </select>
                  </label>
                  <label>
                    Chromosome column
                    <select value={columnMap.chr} onChange={(e) => setColumnMap((prev) => ({ ...prev, chr: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 6 }}>
                      <option value="">Select column...</option>
                      {tableHeaders.map((h) => <option key={`chr-${h}`} value={h}>{h}</option>)}
                    </select>
                  </label>
                  <label>
                    Start column
                    <select value={columnMap.start} onChange={(e) => setColumnMap((prev) => ({ ...prev, start: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 6 }}>
                      <option value="">Select column...</option>
                      {tableHeaders.map((h) => <option key={`start-${h}`} value={h}>{h}</option>)}
                    </select>
                  </label>
                  <label>
                    End column
                    <select value={columnMap.end} onChange={(e) => setColumnMap((prev) => ({ ...prev, end: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 6 }}>
                      <option value="">Select column...</option>
                      {tableHeaders.map((h) => <option key={`end-${h}`} value={h}>{h}</option>)}
                    </select>
                  </label>
                  <label>
                    Existing cM (optional)
                    <select value={columnMap.existingCm} onChange={(e) => setColumnMap((prev) => ({ ...prev, existingCm: e.target.value }))} style={{ display: "block", width: "100%", marginTop: 6 }}>
                      <option value="">None</option>
                      {tableHeaders.map((h) => <option key={`cm-${h}`} value={h}>{h}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              <div style={TABLE_CONTAINER_STYLE}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {columnMap.name ? <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Name</th> : null}
                      {columnMap.snps ? <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>#SNPs</th> : null}
                      <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>
                        <button
                          type="button"
                          onClick={() => toggleTableSort("chr")}
                          style={{ border: 0, background: "transparent", padding: 0, margin: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "inherit" }}
                        >
                          {sortLabel("chr", "Chromosome")}
                        </button>
                      </th>
                      <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>
                        <button
                          type="button"
                          onClick={() => toggleTableSort("start")}
                          style={{ border: 0, background: "transparent", padding: 0, margin: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "inherit" }}
                        >
                          {sortLabel("start", "Start")}
                        </button>
                      </th>
                      <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>
                        <button
                          type="button"
                          onClick={() => toggleTableSort("end")}
                          style={{ border: 0, background: "transparent", padding: 0, margin: 0, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "inherit" }}
                        >
                          {sortLabel("end", "End")}
                        </button>
                      </th>
                      {columnMap.existingCm ? <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0" }}>Existing cM</th> : null}
                      <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", borderLeft: "2px solid #cbd5e1", background: "#eff6ff", color: "#334155" }}>Maternal cM</th>
                      <th style={{ textAlign: "center", padding: "8px 4px", borderBottom: "1px solid #e2e8f0", background: "#eff6ff", color: "#334155", width: 24 }}> </th>
                      <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", background: "#eff6ff", color: "#334155" }}>Paternal cM</th>
                      <th style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e2e8f0", background: "#eff6ff", color: "#334155" }}>Averaged cM</th>
                    </tr>
                    <tr style={{ background: "#f8fafc" }}>
                      {columnMap.name ? <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }} /> : null}
                      {columnMap.snps ? <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }} /> : null}
                      <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                        <select
                          value={tableFilters.chr}
                          onChange={(e) => setTableFilters((prev) => ({ ...prev, chr: e.target.value }))}
                          style={{ width: "100%", fontSize: 12 }}
                        >
                          <option value="">All chromosomes</option>
                          {tableChromosomeOptions.map((chrOption) => (
                            <option key={chrOption} value={chrOption}>{chrOption}</option>
                          ))}
                        </select>
                      </th>
                      <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                        <input
                          type="number"
                          value={tableFilters.startMb}
                          onChange={(e) => setTableFilters((prev) => ({ ...prev, startMb: e.target.value }))}
                          style={{ width: "100%", fontSize: 12 }}
                          placeholder="Min Mb"
                        />
                      </th>
                      <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }}>
                        <input
                          type="number"
                          value={tableFilters.endMb}
                          onChange={(e) => setTableFilters((prev) => ({ ...prev, endMb: e.target.value }))}
                          style={{ width: "100%", fontSize: 12 }}
                          placeholder="Max Mb"
                        />
                      </th>
                      {columnMap.existingCm ? <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0" }} /> : null}
                      <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0", borderLeft: "2px solid #cbd5e1", background: "#eff6ff" }} />
                      <th style={{ padding: "6px 4px", borderBottom: "1px solid #e2e8f0", background: "#eff6ff", width: 24 }} />
                      <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0", background: "#eff6ff" }} />
                      <th style={{ padding: "6px 10px", borderBottom: "1px solid #e2e8f0", background: "#eff6ff" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTableRows.map((row, idx) => {
                      const existingNumeric = toOptionalNumber(String(row.existingCm || "").replace(/,/g, ""));
                      const averageDelta =
                        row.averagedCm !== null && existingNumeric !== null
                          ? row.averagedCm - existingNumeric
                          : null;
                      const averageDeltaPct =
                        averageDelta !== null && existingNumeric !== null && existingNumeric !== 0
                          ? Math.abs(averageDelta / existingNumeric)
                          : null;
                      const showAverageDeltaWarning = Boolean(
                        columnMap.existingCm &&
                        averageDeltaPct !== null &&
                        averageDeltaPct > CM_DELTA_ALERT_THRESHOLD
                      );
                      const averageColor =
                        !showAverageDeltaWarning || averageDelta === null || averageDelta === 0
                          ? "#334155"
                          : averageDelta > 0
                            ? "#b10020"
                            : "#1d4ed8";
                      const averageArrow =
                        !showAverageDeltaWarning || averageDelta === null || averageDelta === 0
                          ? ""
                          : averageDelta > 0
                            ? "↑"
                            : "↓";
                      const matPatDeltaFromAveragePct =
                        row.maternalCm !== null && row.paternalCm !== null && row.averagedCm !== null && row.averagedCm !== 0
                          ? Math.abs(row.maternalCm - row.averagedCm) / row.averagedCm
                          : null;
                      const showMatPatMarker = Boolean(
                        matPatDeltaFromAveragePct !== null && matPatDeltaFromAveragePct > MAT_PAT_IMBALANCE_THRESHOLD
                      );
                      const matPatMarker =
                        !showMatPatMarker
                          ? ""
                          : row.maternalCm > row.paternalCm
                            ? ">>>"
                            : "<<<";

                      return (
                        <tr key={`row-${idx}`}>
                          {columnMap.name ? <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7" }}>{row.name ?? ""}</td> : null}
                          {columnMap.snps ? <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7" }}>{row.snps ?? ""}</td> : null}
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7" }}>{row.chr ?? ""}</td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7" }}>{row.start ?? ""}</td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7" }}>{row.end ?? ""}</td>
                          {columnMap.existingCm ? <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7" }}>{row.existingCm ?? ""}</td> : null}
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7", borderLeft: "2px solid #cbd5e1", background: "#f8fbff", color: "#334155", fontWeight: 700 }}>{row.maternalCm == null ? "" : row.maternalCm.toFixed(4)}</td>
                          <td style={{ padding: "7px 4px", borderBottom: "1px solid #eef2f7", background: "#f8fbff", color: "#9a3412", fontWeight: 800, textAlign: "center", letterSpacing: "0.02em" }}>{matPatMarker}</td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7", background: "#f8fbff", color: "#334155", fontWeight: 700 }}>{row.paternalCm == null ? "" : row.paternalCm.toFixed(4)}</td>
                          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef2f7", background: "#f8fbff", color: averageColor, fontWeight: 800 }}>
                            {row.averagedCm == null ? "" : row.averagedCm.toFixed(4)}
                            {averageArrow ? <span style={{ marginLeft: 6 }}>{averageArrow}</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={TABLE_PAGER_STYLE}>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {totalTableRows
                    ? `Showing rows ${(safeTablePage - 1) * tablePageSize + 1} - ${Math.min(safeTablePage * tablePageSize, totalTableRows)} of ${totalTableRows}`
                    : "Showing 0 rows"}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ fontSize: 12, color: "#4f5f73" }}>
                    Rows per page
                    <select
                      value={tablePageSize}
                      onChange={(event) => {
                        setTablePageSize(Number(event.target.value));
                        setTablePage(1);
                      }}
                      style={{ marginLeft: 8 }}
                    >
                      {[10, 25, 50, 100, 250].map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => setTablePage(1)} style={TABLE_PAGER_BUTTON_STYLE} disabled={safeTablePage <= 1}>
                    First
                  </button>
                  <button type="button" onClick={() => setTablePage((page) => Math.max(1, page - 1))} style={TABLE_PAGER_BUTTON_STYLE} disabled={safeTablePage <= 1}>
                    Prev
                  </button>
                  <div style={{ fontSize: 12, color: "#4f5f73" }}>
                    Page {safeTablePage} of {totalTablePages}
                  </div>
                  <button type="button" onClick={() => setTablePage((page) => Math.min(totalTablePages, page + 1))} style={TABLE_PAGER_BUTTON_STYLE} disabled={safeTablePage >= totalTablePages}>
                    Next
                  </button>
                  <button type="button" onClick={() => setTablePage(totalTablePages)} style={TABLE_PAGER_BUTTON_STYLE} disabled={safeTablePage >= totalTablePages}>
                    Last
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {mode === "manual" && result ? (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: "#f5f8fb",
                border: "1px solid #dae4ee",
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontWeight: 700, marginBottom: 10 }}>
                <div>
                  {result.chromosome} | Segment: {result.start.toLocaleString()} - {result.end.toLocaleString()} bp
                </div>
                <div style={{ width: 1, alignSelf: "stretch", background: "rgba(106, 118, 134, 0.35)" }} />
                <div>
                  Length in megabases (Mb): {result.lengthMb.toFixed(1)}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                {[
                  { label: "Maternal", value: result.maternalCm },
                  { label: "Paternal", value: result.paternalCm },
                  { label: "Averaged", value: result.averagedCm },
                ].map((item) => (
                  <div key={item.label} style={{ padding: 12, borderRadius: 10, background: "#ffffff", border: "1px solid #dbe3ea" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#6a7686" }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>
                      {item.value === null ? "No data" : `${item.value.toFixed(4)} cM`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {mode !== "table" ? (
          <aside style={INFO_PANEL_STYLE}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748b", marginBottom: 8 }}>
            About This Calculator
          </div>
          <div style={{ color: "#4f5f73", lineHeight: 1.55 }}>
            <p style={{ margin: "0 0 10px" }}>
              Calculate centimorgans (cM) between the start and end of a DNA segment using the updated recombination-rate values published by the DECODE project.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              These values come from a recent paper (Palsson et al., 2025) and its accompanying repository, which provide newer maternal and paternal recombination maps than the older reference tables used by many calculators. The updated maps incorporate both non-crossover (NCO) and crossover (CO) information when deriving cM/Mb rates.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              Palsson, G., Hardarson, M. T., Jonsson, H., Steinthorsdottir, V., Stefansson, O. A., Eggertsson, H. P., ... &amp; Stefansson, K. (2025). Complete human recombination maps. Nature, 1-8. <a href="https://doi.org/10.1038/s41586-024-08450-5" target="_blank" rel="noreferrer">https://doi.org/10.1038/s41586-024-08450-5</a>.
            </p>
            <p style={{ margin: "0 0 12px" }}>
              Data source: <a href="https://github.com/DecodeGenetics/PalssonEtAl_Nature_2024" target="_blank" rel="noreferrer">deCODE GitHub Repository</a>.
            </p>
          </div>

          <div style={{ borderTop: "1px solid #dbe3ea", marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748b", marginBottom: 6 }}>
              Planned Batch Mode
            </div>
            <div style={{ fontSize: 13, color: "#4f5f73", lineHeight: 1.5 }}>
              Planned: drop CSV, TXT, or Excel files, map chromosome/start/end columns (and optional existing cM), then append maternal, paternal, and averaged cM columns.
            </div>
          </div>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
