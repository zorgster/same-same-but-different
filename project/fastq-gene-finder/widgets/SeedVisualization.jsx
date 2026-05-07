import { FASTQ_GENE_FINDER_CONFIG } from "../fastq-gene-finder-config";
import * as Styles from "../styles/fastq-gene-finder-styles.jsx";

/* ============================================================
   COMPONENT: SeedVisualization
============================================================ */
export default function SeedVisualization({ seedArrays, readLength }) {
  if (!readLength || !seedArrays.length) {
    return (
      <div style={Styles.seedPanel}>
        <h3>Seed Arrays (awaiting file & gene)</h3>
      </div>
    );
  }

  const squareSize = Math.max(2, Math.min(8, 400 / readLength));
  const gap = 1;

  return (
    <div style={Styles.seedPanel}>
      <h3>
        Seed Arrays ({seedArrays.length} seeds, {readLength} positions —{" "}
        {FASTQ_GENE_FINDER_CONFIG.positionsPerSeedArray} positions/seed)
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        {seedArrays.map((seed, seedIdx) => {
          const seedSet = new Set(seed.positions);

          return (
            <div
              key={seedIdx}
              style={{ display: "flex", alignItems: "center", gap: "8px" }}
            >
              <span style={{ width: "90px", fontSize: "11px" }}>
                {seed.label}
              </span>
              <div style={{ display: "flex", gap: `${gap}px` }}>
                {Array.from({ length: readLength }).map((_, pos) => (
                  <div
                    key={pos}
                    style={{
                      width: `${squareSize}px`,
                      height: `${squareSize}px`,
                      backgroundColor: seedSet.has(pos) ? "#000" : "#fff",
                      border: "1px solid #ccc",
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
