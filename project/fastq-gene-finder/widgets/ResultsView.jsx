import { memo, useMemo, useState } from "react";
import { decodeRead } from "../utils/seqUtils.js";

const PAGE_SIZE = 100;

const MONO = '"Courier New", Courier, monospace';

const SeedMatchDots = memo(function SeedMatchDots({ seedIds = [], seedArrays = [] }) {
  const matched = useMemo(() => new Set(seedIds), [seedIds]);
  return (
    <span>
      {seedArrays.map((seed, i) => (
        <span
          key={seed.id ?? i}
          title={`Seed ${seed.id ?? i}`}
          style={{
            display: "inline-block",
            width: "5px",
            height: "5px",
            backgroundColor: matched.has(seed.id) ? "#222" : "#fff",
            border: "1px solid #bbb",
            margin: "0 1px",
            verticalAlign: "middle",
          }}
        />
      ))}
    </span>
  );
});

const fmtOr = (or) => or === 1 ? "+" : or === 0 ? "−" : "";

/* ============================================================
   COMPONENT: ResultsView
============================================================ */
export default memo(function ResultsView({
  matchingReads,
  seedArrays = [],
  validatedPairs = [],
  greyedR1 = [],
}) {
  const [page, setPage] = useState(0);

  const pairedMode = validatedPairs.length > 0 || greyedR1.length > 0;
  const pairMap = useMemo(() => {
    const m = new Map();
    for (const p of validatedPairs) m.set(p.r1.index, p);
    for (const r of greyedR1)      m.set(r.index, null); // null = unconfirmed
    return m;
  }, [validatedPairs, greyedR1]);

  const totalPages = Math.max(1, Math.ceil(matchingReads.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const pageStart  = safePage * PAGE_SIZE;
  const pageEnd    = pageStart + PAGE_SIZE;

  const displayReads = useMemo(
    () => matchingReads.slice(pageStart, pageEnd),
    [pageStart, Math.min(matchingReads.length, pageEnd)], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleExport = () => {
    const headers = [
      "readNumber", "fastqHeaderLine", "fastqSequenceLine",
      "position", "orientation", "score", "source", "seedIds", "read",
      ...(pairedMode ? ["pairStatus", "r2Position", "r2Orientation", "r2Score", "insertSize", "r2Read"] : []),
    ];
    const csv = [
      headers.join(","),
      ...matchingReads.map((m) => {
        const base = [
          m.readNumber ?? "",
          m.fastqHeaderLine ?? "",
          m.fastqSequenceLine ?? "",
          m.position,
          m.orientation === 1 ? "forward" : m.orientation === 0 ? "reverse" : "",
          m.score,
          m.source ?? "genomic",
          (m.seedIds || []).join("|"),
          `"${decodeRead(m)}"`,
        ];
        if (pairedMode) {
          const pair = pairMap.get(m.index);
          if (pair === undefined) {
            base.push("single", "", "", "", "", "");
          } else if (pair === null) {
            base.push("unconfirmed", "", "", "", "", "");
          } else {
            const r2 = pair.r2;
            base.push(
              "paired",
              r2.position ?? "",
              r2.orientation === 1 ? "forward" : r2.orientation === 0 ? "reverse" : "",
              r2.score ?? "",
              pair.insertSize ?? "",
              `"${decodeRead(r2)}"`,
            );
          }
        }
        return base.join(",");
      }),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `matching_reads-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const btnStyle = {
    padding: "2px 8px",
    fontSize: "11px",
    cursor: "pointer",
    marginLeft: "0.25rem",
  };

  // Table styles
  const TH = (align = "right") => ({
    textAlign: align,
    padding: "3px 6px",
    borderBottom: "2px solid #444",
    fontWeight: 700,
    fontSize: "10px",
    fontFamily: MONO,
    whiteSpace: "nowrap",
    background: "#f0f0f0",
    position: "sticky",
    top: 0,
    zIndex: 1,
  });

  const TD = (align = "right", extra = {}) => ({
    textAlign: align,
    padding: "2px 6px",
    borderBottom: "1px solid #e8e8e8",
    verticalAlign: "top",
    fontFamily: MONO,
    fontSize: "10px",
    ...extra,
  });

  return (
    <div style={{ marginTop: "1rem", border: "2px solid #444", padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <h3 style={{ margin: 0 }}>Matching Reads ({matchingReads.length})</h3>
        {matchingReads.length > 0 && (
          <button onClick={handleExport} style={{ padding: "4px 8px", fontSize: "11px" }}>
            Export CSV
          </button>
        )}
      </div>

      {matchingReads.length > 0 && (
        <div style={{ fontSize: "11px", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
          <span>{pageStart + 1}–{Math.min(pageEnd, matchingReads.length)} of {matchingReads.length}</span>
          <button style={btnStyle} disabled={safePage === 0} onClick={() => setPage(0)}>««</button>
          <button style={btnStyle} disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>‹ Prev</button>
          <span>Page {safePage + 1} / {totalPages}</span>
          <button style={btnStyle} disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next ›</button>
          <button style={btnStyle} disabled={safePage >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»»</button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={TH("right")}   title="FASTQ read number">Read</th>
              <th style={TH("right")}   title="Line number in FASTQ file">Line</th>
              <th style={TH("right")}   title="Position in gene sequence">Pos</th>
              <th style={TH("center")}  title="Number of seeds that voted for this read">Score</th>
              <th style={TH("center")}  title="Strand orientation">Or</th>
              <th style={TH("center")}  title="Spliced across intron">Spl</th>
              {pairedMode && <th style={TH("center")} title="R2 read validated">Pair</th>}
              {pairedMode && <th style={TH("right")}  title="Inferred insert size in base pairs">Insert (bp)</th>}
              <th style={TH("center")}  title="Seed votes — filled = matched">Seeds</th>
              <th style={TH("left")}    title="Read sequence (R1, and R2 if paired)">Sequence</th>
            </tr>
          </thead>
          <tbody>
            {displayReads.map((m, i) => {
              const pair         = pairedMode ? pairMap.get(m.index) : undefined;
              const isUnconfirmed = pairedMode && pair === null;
              const isPaired      = pairedMode && pair != null;
              const rowBg = i % 2 === 0 ? "#fff" : "#f9f9f9";
              const readStr = decodeRead(m);
              const r2Str   = isPaired ? decodeRead(pair.r2) : null;

              return (
                <tr
                  key={pageStart + i}
                  style={{ background: rowBg, opacity: isUnconfirmed ? 0.45 : 1 }}
                >
                  <td style={TD("right")}>{m.readNumber ?? "?"}</td>
                  <td style={TD("right")}>{m.fastqSequenceLine ?? "?"}</td>
                  <td style={TD("right")}>{m.position ?? "?"}</td>
                  <td style={TD("center")}>{m.score ?? "?"}</td>
                  <td style={TD("center", { fontWeight: 600 })}>
                    {fmtOr(m.orientation)}
                  </td>
                  <td style={TD("center", { color: "#0a9" })}>
                    {m.source != null ? "✓" : ""}
                  </td>
                  {pairedMode && (
                    <td style={TD("center", {
                      color: isPaired ? "#7bb3d4" : isUnconfirmed ? "#bbb" : "#ccc",
                      fontWeight: isPaired ? 600 : 400,
                    })}>
                      {isPaired ? "✓" : isUnconfirmed ? "?" : ""}
                    </td>
                  )}
                  {pairedMode && (
                    <td style={TD("right", { color: "#7bb3d4" })}>
                      {isPaired ? pair.insertSize : ""}
                    </td>
                  )}
                  <td style={TD("center", { whiteSpace: "nowrap" })}>
                    <SeedMatchDots seedIds={m.seedIds || []} seedArrays={seedArrays} />
                  </td>
                  <td style={TD("left", { whiteSpace: "pre", letterSpacing: "0.02em" })}>
                    <span title={readStr}>{readStr}</span>
                    {isPaired && (
                      <div style={{ color: "#5a8fb8", marginTop: "1px" }}>
                        {r2Str}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
