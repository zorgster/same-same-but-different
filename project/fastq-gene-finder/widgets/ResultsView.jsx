import * as Styles from "../styles/fastq-gene-finder-styles.jsx";

function SeedMatchDots({ seedIds = [], seedArrays = [] }) {
  const matched = new Set(seedIds);

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
}

/* ============================================================
   COMPONENT: ResultsView
============================================================ */
export default function ResultsView({ matchingReads, seedArrays = [] }) {
  const handleExport = () => {
    const csv = [
      [
        "readNumber",
        "fastqHeaderLine",
        "fastqSequenceLine",
        "position",
        "orientation",
        "score",
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
      <div
        style={{ maxHeight: 400, overflow: "auto", fontFamily: "monospace" }}
      >
        {matchingReads.map((m, i) => (
          <div key={i} style={{ fontSize: "10px" }}>
            read={m.readNumber ?? "?"} line={m.fastqSequenceLine ?? "?"} pos=
            {m.position ?? m.positions?.[0]} score=
            {m.score ?? m.scores?.[0]} orientation=
            {m.orientation ?? ""}
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
}
