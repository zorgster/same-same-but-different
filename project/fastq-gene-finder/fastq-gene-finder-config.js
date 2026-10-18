export const FASTQ_GENE_FINDER_CONFIG = {
  // Positions sampled per seed array = 14% of read length (as in the Rust version):
  // 14 for 100 bp, 21 for 150 bp. Capped at 26 so 2-bit keys stay exact in a
  // float64 (4^26 < 2^53).
  positionsPerSeedFraction: 0.14,
  maxPositionsPerSeedArray: 26,
  geneScanStep: 1,
  seedFamilies: [
    {
      label: "start-heavy",
      count: 3,
      startFraction: 0,
      endFraction: 0.25,
    },
    {
      label: "middle",
      count: 3,
      startFraction: 0.25,
      endFraction: 0.75,
    },
    {
      label: "end-heavy",
      count: 3,
      startFraction: 0.75,
      endFraction: 1,
    },
    {
      label: "whole-length",
      count: 4,
      startFraction: 0,
      endFraction: 1,
    },
  ],
};
