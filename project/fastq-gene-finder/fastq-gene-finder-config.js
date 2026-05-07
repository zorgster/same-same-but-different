export const FASTQ_GENE_FINDER_CONFIG = {
  positionsPerSeedArray: 14,
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
