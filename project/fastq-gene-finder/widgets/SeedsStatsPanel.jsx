export default function SeedStatsPanel({ seedStats = {}, seedArrays = [] }) {
  const perSeed = Array.isArray(seedStats.perSeedStats)
    ? seedStats.perSeedStats
    : [];
  const topUnique = Array.isArray(seedStats.topUniqueSamples)
    ? seedStats.topUniqueSamples
    : [];

  const statsTooltip =
    "Distinct samples: the number of unique sampled seed keys seen for this seed.\n" +
    "Singletons: keys that only occur once in the gene sequence.\n" +
    "Total alignments: total gene window hits across all sampled keys, counting repeats.";

  if (!perSeed.length && !topUnique.length) return null;

  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "0.5rem",
        border: "1px solid #ccc",
        fontSize: "12px",
      }}
    >
      <h4 style={{ margin: "0 0 6px 0" }}>
        Most Unique Sampled Keys (top {topUnique.length})
      </h4>

      {topUnique.length === 0 ? (
        <div>No sampled keys available.</div>
      ) : (
        <div
          style={{
            fontFamily: '"Courier New", Courier, monospace',
            marginBottom: "6px",
          }}
        >
          {topUnique.map((s, i) => (
            <div
              key={`${s.seedId}-${s.sampleKey}-${i}`}
              style={{ marginBottom: "4px" }}
            >
              <strong>Seed #{s.seedId}</strong> ({s.seedLabel}) — occurrences:{" "}
              <strong>{s.count}</strong>
              <div
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 360,
                }}
              >
                key: {s.sampleKey} &nbsp; positions: [{s.positions.join(", ")}
                {s.positions.length >= 20 ? ", ..." : ""}]
              </div>
            </div>
          ))}
        </div>
      )}

      <h4
        style={{
          margin: "8px 0 6px 0",
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
        }}
      >
        <span>Per-seed summary</span>
        <span
          title={statsTooltip}
          aria-label={statsTooltip}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            border: "1px solid #666",
            fontSize: "11px",
            lineHeight: 1,
            cursor: "help",
            userSelect: "none",
          }}
        >
          ?
        </span>
      </h4>

      <div style={{ fontSize: "11px" }}>
        {perSeed.map((ps) => (
          <div key={ps.seedId} style={{ marginBottom: "4px" }}>
            <strong>Seed #{ps.seedId}</strong> ({ps.seedLabel}) — distinct
            samples: {ps.distinctSamples}, singletons: {ps.singletonCount},
            total alignments: {ps.totalAlignments}
          </div>
        ))}
      </div>
    </div>
  );
}
