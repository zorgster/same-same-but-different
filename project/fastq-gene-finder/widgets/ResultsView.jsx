import { memo, useMemo, useState } from "react";
import * as Styles from "../styles/fastq-gene-finder-styles.jsx";

const PAGE_SIZE = 100;

const SeedMatchDots = memo(function SeedMatchDots({ seedIds = [], seedArrays = [] }) {
  const matched = useMemo(() => new Set(seedIds), [seedIds]);

  return (
    <span style={{ marginLeft: "0.5rem" }}>
      {seedArrays.map((seed, i) => (
        <span
          key={seed.id ?? i}
          title={`Seed ${seed.id ?? i}`}
          style={{
            display: "inline-block",
            width: "5px",
            height: "5px",
            backgroundColor: matched.has(seed.id) ? "#000" : "#fff",
            border: "1px solid #ccc",
            margin: "0 1px",
            verticalAlign: "middle",
          }}
        />
      ))}
    </span>
  );
});

/* ============================================================
   COMPONENT: ResultsView
============================================================ */
export default memo(function ResultsView({ matchingReads, seedArrays = [] }) {
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(matchingReads.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);

  const pageStart = safePage * PAGE_SIZE;
  const pageEnd = pageStart + PAGE_SIZE;

  // Recompute the row slice only when: page changes (pageStart), or items are added to THIS
  // page (length < pageEnd). Once the page is full, Math.min stabilises at pageEnd and the
  // slice — and therefore all 100 row renders — are skipped on every subsequent matchingReads update.
  const displayReads = useMemo(
    () => matchingReads.slice(pageStart, pageEnd),
    [pageStart, Math.min(matchingReads.length, pageEnd)], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const handleExport = () => {
    const csv = [
      [
        "readNumber",
        "fastqHeaderLine",
        "fastqSequenceLine",
        "position",
        "orientation",
        "score",
        "source",
        "seedIds",
        "read",
      ].join(","),
      ...matchingReads.map((m) =>
        [
          m.readNumber ?? "",
          m.fastqHeaderLine ?? "",
          m.fastqSequenceLine ?? "",
          m.position ?? m.positions?.[0],
          m.orientation ?? "",
          m.score ?? m.scores?.[0],
          m.source ?? "genomic",
          (m.seedIds || []).join("|"),
          `"${m.read || ""}"`,
        ].join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
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

  return (
    <div
      style={{ marginTop: "1rem", border: "2px solid #444", padding: "1rem" }}
    >
      <h3>
        Matching Reads ({matchingReads.length})
        {matchingReads.length > 0 && (
          <button
            onClick={handleExport}
            style={{ marginLeft: "1rem", padding: "4px 8px", fontSize: "11px" }}
          >
            Export CSV
          </button>
        )}
      </h3>
      {matchingReads.length > 0 && (
        <div style={{ fontSize: "11px", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "0.25rem" }}>
          <span>
            {pageStart + 1}–{pageEnd} of {matchingReads.length}
          </span>
          <button
            style={btnStyle}
            disabled={safePage === 0}
            onClick={() => setPage(0)}
          >
            ««
          </button>
          <button
            style={btnStyle}
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ‹ Prev
          </button>
          <span>Page {safePage + 1} / {totalPages}</span>
          <button
            style={btnStyle}
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          >
            Next ›
          </button>
          <button
            style={btnStyle}
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage(totalPages - 1)}
          >
            »»
          </button>
        </div>
      )}
      <div style={{ fontFamily: "monospace" }}>
        {displayReads.map((m, i) => (
          <div key={pageStart + i} style={{ fontSize: "10px" }}>
            read={m.readNumber ?? "?"} line={m.fastqSequenceLine ?? "?"} pos=
            {m.position ?? m.positions?.[0]} score=
            {m.score ?? m.scores?.[0]} orientation=
            {m.orientation ?? ""}
            {m.source === "spliced" && (
              <span style={{ color: "#0a9", marginLeft: "0.3rem" }}>[spliced]</span>
            )}
            <SeedMatchDots
              seedIds={m.seedIds || []}
              seedArrays={seedArrays}
            />{" "}
            {m.read}
          </div>
        ))}
      </div>
    </div>
  );
});
