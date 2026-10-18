import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import DropZone from "../widgets/DropZone";
import RadarChart from "./widgets/RadarChart";
import { splitPastedText, parseRows, averageFor } from "./parsers/table-parser";
import { COLORS, MONO_FONT, UI_FONT } from "../styles/light-theme";

const SAMPLE = [
  "Name\tClarity\tUsefulness\tEase of use\tResponsiveness\tValue\tOverall",
  "Alex\t4\t3.5\t4.5\t3\t4\t4",
  "Bo\t3\t4\t3\t4.5\t3.5\t3.5",
  "Chen\t5\t4.5\t4\t4\t4.5\t4.5",
  "Dana\t2.5\t3\t3.5\t3\t2.5\t3",
  "Eli\t4\t4\t3\t3.5\t4\t3.5",
].join("\n");

const PALETTE = ["#0f766e", "#a1562f", "#5b5f8a", "#8a4f6b", "#3f7a9e", "#9a8a2f", "#6b4f9a", "#2f8a6f"];
const BEST_COLOR = "#c98a3b";
const AVG_COLOR = "#5b5f8a";

const DASHES = [
  { label: "Solid", value: "" },
  { label: "Dashed", value: "6 4" },
  { label: "Dotted", value: "2 3" },
  { label: "Dash-dot", value: "8 3 2 3" },
];
const WIDTHS = [1, 2, 3, 4];

const styles = {
  app: { minHeight: "100vh", background: COLORS.bg, fontFamily: UI_FONT, color: COLORS.text, padding: "32px 24px" },
  wrap: { maxWidth: 1100, margin: "0 auto" },
  title: { fontSize: 26, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 13, color: COLORS.muted, margin: "6px 0 20px", maxWidth: "62ch" },
  card: { background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginBottom: 16 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 },
  label: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLORS.muted, display: "block", marginBottom: 6 },
  textarea: { width: "100%", minHeight: 160, resize: "vertical", boxSizing: "border-box", fontFamily: MONO_FONT, fontSize: 13, background: COLORS.bg, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 10 },
  row: { display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 },
  number: { width: 90, padding: "7px 9px", fontSize: 14, border: `1px solid ${COLORS.border}`, borderRadius: 6, background: COLORS.bg, color: COLORS.text },
  button: (ghost) => ({ background: ghost ? "transparent" : COLORS.accent, color: ghost ? COLORS.accent : "#fff", border: ghost ? `1px solid ${COLORS.accent}` : "none", borderRadius: 7, padding: "9px 18px", fontWeight: 600, cursor: "pointer" }),
  error: { color: COLORS.error, fontSize: 13, marginTop: 8 },
  chartCard: { display: "flex", flexDirection: "column", alignItems: "center" },
  legend: { display: "flex", flexWrap: "wrap", gap: "10px 16px", justifyContent: "center", fontSize: 13, marginTop: 12 },
  swatch: (c) => ({ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: c, marginRight: 6 }),
  h3: { fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: COLORS.muted, margin: "0 0 8px" },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 },
  chip: (on, color) => ({ border: `1px solid ${on ? color : COLORS.border}`, background: on ? COLORS.accentSoft : COLORS.bg, color: COLORS.text, borderRadius: 999, padding: "4px 10px", fontSize: 12, cursor: "pointer" }),
  editor: { border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: 12, marginBottom: 20, background: COLORS.bg },
  editorRow: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: 10 },
  colorDot: (c, on) => ({ width: 22, height: 22, borderRadius: "50%", background: c, cursor: "pointer", padding: 0, border: on ? `3px solid ${COLORS.text}` : `1px solid ${COLORS.border}` }),
  select: { padding: "5px 8px", fontSize: 13, border: `1px solid ${COLORS.border}`, borderRadius: 6, background: COLORS.surface, color: COLORS.text },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13, fontVariantNumeric: "tabular-nums" },
  cell: { borderBottom: `1px solid ${COLORS.border}`, padding: "4px 6px", textAlign: "left" },
};

export default function QuestionnaireSpider() {
  const [text, setText] = useState(SAMPLE);
  const [best, setBest] = useState(5);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(5);
  const [hidden, setHidden] = useState(() => new Set());
  const [file, setFile] = useState(null);
  const [fileRows, setFileRows] = useState(null);
  const [fileError, setFileError] = useState("");
  const [overrides, setOverrides] = useState({}); // key -> { color, dash, width }
  const [editing, setEditing] = useState(null);

  const { data, error } = useMemo(() => {
    try {
      return { data: parseRows(fileRows ?? splitPastedText(text)), error: "" };
    } catch (e) {
      return { data: null, error: e.message };
    }
  }, [text, fileRows]);

  const onFile = async (files) => {
    const f = files[0];
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      setFile(f);
      setFileRows(rows);
      setFileError("");
      setHidden(new Set());
    } catch {
      setFileError(`Could not read ${f.name}.`);
    }
  };

  const onText = (v) => {
    setText(v);
    setFile(null);
    setFileRows(null);
    setFileError("");
    setHidden(new Set());
  };

  const toggle = (name) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const averages = data ? data.questions.map((_, qi) => averageFor(data.people, qi)) : [];
  const allSeries = (data ? [
    ...data.people.map((p, i) => ({ key: `p:${p.name}`, label: p.name, values: p.values, color: PALETTE[i % PALETTE.length], fill: true, showPoints: true })),
    { key: "best", label: "Best possible", values: data.questions.map(() => best), color: BEST_COLOR, dash: "6 4" },
    { key: "avg", label: "Average", values: averages, color: AVG_COLOR, dash: "2 3", width: 2.5, showPoints: true },
  ] : []).map((s) => ({ ...s, ...overrides[s.key] }));
  const visible = allSeries.filter((s) => !hidden.has(s.label));
  const editingSeries = allSeries.find((s) => s.key === editing);
  const restyle = (key, patch) => setOverrides((o) => ({ ...o, [key]: { ...o[key], ...patch } }));

  return (
    <div style={styles.app}>
      <div style={styles.wrap}>
        <h1 style={styles.title}>Questionnaire Spider</h1>
        <p style={styles.subtitle}>
          Paste your questionnaire table from Excel (or drop a CSV/XLSX) — one row per person, one column per question — and plot everyone's answers against the best possible score and the group average.
        </p>

        <div style={styles.card}>
          <label style={styles.label} htmlFor="qs-paste">Paste table (include the header row)</label>
          <textarea
            id="qs-paste"
            style={styles.textarea}
            spellCheck={false}
            value={fileRows ? "" : text}
            placeholder={fileRows ? `Using ${file?.name} — type here to switch back to pasted data` : ""}
            onChange={(e) => onText(e.target.value)}
          />
          <div style={{ marginTop: 12 }}>
            <DropZone
              onFilesSelected={onFile}
              accept={{ "text/csv": [".csv"], "application/vnd.ms-excel": [".xls"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] }}
              label="Or drop a CSV or Excel file here (first sheet is used)"
              selectedFiles={file ? [file] : []}
            />
          </div>
          <div style={styles.row}>
            {[["Best possible answer", best, setBest], ["Axis min", min, setMin], ["Axis max", max, setMax]].map(([lbl, val, set]) => (
              <div key={lbl}>
                <label style={styles.label}>{lbl}</label>
                <input type="number" step={0.5} style={styles.number} value={val} onChange={(e) => set(parseFloat(e.target.value) || 0)} />
              </div>
            ))}
            <button type="button" style={styles.button(true)} onClick={() => onText(SAMPLE)}>Load sample</button>
          </div>
          {(error || fileError) && <div style={styles.error}>{fileError || error}</div>}
        </div>

        {data && (
          <div style={styles.grid}>
            <div style={{ ...styles.card, ...styles.chartCard }}>
              <RadarChart questions={data.questions} series={visible} min={min} max={max} />
              <div style={styles.legend}>
                {visible.map((s) => (
                  <button key={s.key} type="button" title="Click to change colour and line style" onClick={() => setEditing(s.key)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: COLORS.text, fontSize: 13, textDecoration: editing === s.key ? "underline" : "none" }}>
                    <svg width={26} height={10} style={{ marginRight: 6 }}><line x1={0} y1={5} x2={26} y2={5} stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash || undefined} /></svg>{s.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={styles.card}>
              <h3 style={styles.h3}>Show / hide people · click a dot to restyle</h3>
              <div style={styles.chips}>
                {data.people.map((p, i) => (
                  <span key={i} style={{ ...styles.chip(!hidden.has(p.name), allSeries[i].color), display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <button type="button" title="Change colour and line style" onClick={() => setEditing(allSeries[i].key)} style={{ ...styles.colorDot(allSeries[i].color, editing === allSeries[i].key), width: 14, height: 14 }} />
                    <button type="button" aria-pressed={!hidden.has(p.name)} onClick={() => toggle(p.name)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: COLORS.text, fontSize: 12 }}>{p.name}</button>
                  </span>
                ))}
                {["best", "avg"].map((k) => {
                  const s = allSeries.find((x) => x.key === k);
                  return <button key={k} type="button" style={styles.chip(editing === k, s.color)} onClick={() => setEditing(k)}><span style={styles.swatch(s.color)} />{s.label}</button>;
                })}
              </div>
              {editingSeries && (
                <div style={styles.editor}>
                  <strong style={{ fontSize: 13 }}>{editingSeries.label}</strong>
                  <div style={styles.editorRow}>
                    {[...PALETTE, BEST_COLOR].map((c) => (
                      <button key={c} type="button" aria-label={c} style={styles.colorDot(c, editingSeries.color === c)} onClick={() => restyle(editing, { color: c })} />
                    ))}
                    <input type="color" aria-label="Custom colour" value={editingSeries.color} onChange={(e) => restyle(editing, { color: e.target.value })} />
                  </div>
                  <div style={styles.editorRow}>
                    <select style={styles.select} aria-label="Line style" value={editingSeries.dash || ""} onChange={(e) => restyle(editing, { dash: e.target.value })}>
                      {DASHES.map((d) => <option key={d.label} value={d.value}>{d.label}</option>)}
                    </select>
                    <select style={styles.select} aria-label="Line width" value={editingSeries.width ?? 2} onChange={(e) => restyle(editing, { width: parseFloat(e.target.value) })}>
                      {WIDTHS.map((w) => <option key={w} value={w}>{w}px</option>)}
                    </select>
                    <button type="button" style={styles.button(true)} onClick={() => { setOverrides((o) => { const n = { ...o }; delete n[editing]; return n; }); }}>Reset</button>
                    <button type="button" style={styles.button(true)} onClick={() => setEditing(null)}>Done</button>
                  </div>
                </div>
              )}
              <h3 style={styles.h3}>Questions detected</h3>
              <table style={styles.table}>
                <thead><tr>{["Question", "Average", "Best"].map((h) => <th key={h} style={styles.cell}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.questions.map((q, qi) => (
                    <tr key={qi}><td style={styles.cell}>{q}</td><td style={styles.cell}>{averages[qi] ?? "–"}</td><td style={styles.cell}>{best}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
