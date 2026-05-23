// One-letter family code for compact seed column headers
const SEED_FAMILY_CODE = {
  "start-heavy": "S",
  middle: "M",
  "end-heavy": "E",
  "whole-length": "W",
};

// Short readable biotype labels
const BIOTYPE_SHORT = {
  protein_coding: "protein_coding",
  retained_intron: "retained_intron",
  processed_transcript: "proc_transcript",
  nonsense_mediated_decay: "NMD",
  non_stop_decay: "non_stop_decay",
  protein_coding_CDS_not_defined: "prot_CDS_undef",
  lncRNA: "lncRNA",
  miRNA: "miRNA",
  snRNA: "snRNA",
  snoRNA: "snoRNA",
};

const thBase = {
  position: "sticky",
  top: 0,
  background: "#f5f5f5",
  fontSize: "10px",
  fontFamily: '"Courier New", Courier, monospace',
  padding: "2px 4px",
  borderBottom: "1px solid #ccc",
  whiteSpace: "nowrap",
};

export function TxSeedIndexPanel({ txIndexStats, seedArrays = [] }) {
  if (!txIndexStats?.length) return null;

  // Max spliced length across all transcripts — for heat-map scaling
  const maxLen = Math.max(1, ...txIndexStats.map((t) => t.splicedLen || 0));

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
        Transcript × Seed Index ({txIndexStats.length} transcript
        {txIndexStats.length !== 1 ? "s" : ""})
      </h4>
      <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "320px" }}>
        <table
          style={{
            borderCollapse: "collapse",
            tableLayout: "fixed",
            minWidth: "max-content",
          }}
        >
          <colgroup>
            <col style={{ width: "150px" }} />
            <col style={{ width: "100px" }} />
            <col style={{ width: "28px" }} />
            <col style={{ width: "62px" }} />
            <col style={{ width: "50px" }} />
            {seedArrays.map((s) => (
              <col key={s.id} style={{ width: "48px" }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...thBase, textAlign: "left" }}>ID</th>
              <th style={{ ...thBase, textAlign: "left" }}>Type</th>
              <th
                style={{ ...thBase, textAlign: "center" }}
                title="Canonical transcript"
              >
                Can.
              </th>
              <th style={{ ...thBase, textAlign: "right" }}>Len (bp)</th>
              <th
                style={{ ...thBase, textAlign: "right" }}
                title="Seed keys exclusive to this transcript (shared by no other transcript)"
              >
                Uniq.
              </th>
              {seedArrays.map((s) => (
                <th
                  key={s.id}
                  style={{ ...thBase, textAlign: "right" }}
                  title={`${s.label} — seed #${s.id}`}
                >
                  Seed#{s.id}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txIndexStats.map((t) => {
              const lenFrac = (t.splicedLen || 0) / maxLen;
              return (
                <tr key={t.txId} style={{ borderBottom: "1px solid #eeeeee" }}>
                  <td
                    style={{
                      fontFamily: '"Courier New", Courier, monospace',
                      fontSize: "10px",
                      textAlign: "left",
                      padding: "1px 4px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontWeight: t.isCanonical ? 700 : 400,
                    }}
                    title={t.txId}
                  >
                    {t.txId}
                  </td>
                  <td
                    style={{
                      fontFamily: '"Courier New", Courier, monospace',
                      fontSize: "10px",
                      textAlign: "left",
                      padding: "1px 4px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: t.biotype === "protein_coding" ? "#333" : "#888",
                    }}
                    title={t.biotype}
                  >
                    {BIOTYPE_SHORT[t.biotype] ?? t.biotype}
                  </td>
                  <td
                    style={{
                      fontFamily: '"Courier New", Courier, monospace',
                      fontSize: "10px",
                      textAlign: "center",
                      padding: "1px 4px",
                    }}
                  >
                    {t.isCanonical ? "*" : ""}
                  </td>
                  <td
                    style={{
                      fontFamily: '"Courier New", Courier, monospace',
                      fontSize: "10px",
                      textAlign: "right",
                      padding: "1px 4px",
                      whiteSpace: "nowrap",
                      background: `rgba(60,160,200,${(lenFrac * 0.25).toFixed(3)})`,
                    }}
                  >
                    {(t.splicedLen || 0).toLocaleString()}
                  </td>
                  <td
                    style={{
                      fontFamily: '"Courier New", Courier, monospace',
                      fontSize: "10px",
                      textAlign: "right",
                      padding: "1px 4px",
                      whiteSpace: "nowrap",
                      color: t.txUniqueTotalKeys > 0 ? "#3aa7a3" : "#bbb",
                      fontWeight: t.txUniqueTotalKeys > 0 ? 700 : 400,
                    }}
                    title={`${t.txUniqueTotalKeys} seed key${t.txUniqueTotalKeys !== 1 ? "s" : ""} exclusive to this transcript`}
                  >
                    {t.txUniqueTotalKeys > 0 ? t.txUniqueTotalKeys : "—"}
                  </td>
                  {t.perSeed.map((ps, si) => {
                    const allUnique = ps.uniqueKeys === ps.totalPositions;
                    return (
                      <td
                        key={si}
                        style={{
                          fontFamily: '"Courier New", Courier, monospace',
                          fontSize: "10px",
                          textAlign: "right",
                          padding: "1px 4px",
                          whiteSpace: "nowrap",
                          color: allUnique ? "#555" : "#b06030",
                        }}
                        title={`unique keys: ${ps.uniqueKeys}  total positions: ${ps.totalPositions}`}
                      >
                        {allUnique
                          ? ps.totalPositions
                          : `${ps.uniqueKeys}/${ps.totalPositions}`}
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
          fontSize: "10px",
          color: "#888",
          marginTop: "4px",
          fontFamily: "monospace",
        }}
      >
        Len: spliced sequence length &nbsp;|&nbsp; seed cells: positions
        (all-unique) or unique/total (collisions in amber)
      </div>
    </div>
  );
}

const statsTooltip =
  "Distinct samples: the number of unique sampled seed keys seen for this seed.\n" +
  "Singletons: keys that only occur once in the gene sequence.\n" +
  "Total alignments: total gene window hits across all sampled keys, counting repeats.";

export function MostUniquesPanel({ seedStats = {} }) {
  const topUnique = Array.isArray(seedStats.topUniqueSamples)
    ? seedStats.topUniqueSamples
    : [];

  return (
    <div
      style={{
        padding: "0.5rem",
        border: "1px solid #ccc",
        fontSize: "12px",
        flex: 1,
        minWidth: 0,
      }}
    >
      <h4 style={{ margin: "0 0 6px 0" }}>
        Most Unique Sampled Keys (top {topUnique.length})
      </h4>
      {topUnique.length === 0 ? (
        <div style={{ color: "#888" }}>No data yet.</div>
      ) : (
        <div style={{ fontFamily: '"Courier New", Courier, monospace' }}>
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
    </div>
  );
}

export function PerSeedSummaryPanel({ seedStats = {} }) {
  const perSeed = Array.isArray(seedStats.perSeedStats)
    ? seedStats.perSeedStats
    : [];

  return (
    <div
      style={{
        padding: "0.5rem",
        border: "1px solid #ccc",
        fontSize: "12px",
        flex: 1,
        minWidth: 0,
      }}
    >
      <h4
        style={{
          margin: "0 0 6px 0",
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
      {perSeed.length === 0 ? (
        <div style={{ color: "#888" }}>No data yet.</div>
      ) : (
        <div style={{ fontSize: "11px" }}>
          {perSeed.map((ps) => (
            <div key={ps.seedId} style={{ marginBottom: "4px" }}>
              <strong>Seed #{ps.seedId}</strong> ({ps.seedLabel}) — distinct
              samples: {ps.distinctSamples}, singletons: {ps.singletonCount},
              total alignments: {ps.totalAlignments}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
