import { describe, it, expect } from "vitest";
import {
  buildIntervals,
  calculateSegmentCm,
  parseMapTsv,
} from "../genetic-distance-calculator/map-utils.js";
import fs from "fs";
import path from "path";

const matPath = path.join(
  process.cwd(),
  "genetic-distance-calculator",
  "data",
  "maps.mat.tsv",
);
const patPath = path.join(
  process.cwd(),
  "genetic-distance-calculator",
  "data",
  "maps.pat.tsv",
);
const matText = fs.readFileSync(matPath, "utf-8");
const patText = fs.readFileSync(patPath, "utf-8");

describe("TSV data check", () => {
  it("has the expected TSV map data", () => {
    expect(matText).toBeTruthy();
    expect(patText).toBeTruthy();
    expect(matText.length).toBeGreaterThan(100);
    expect(patText.length).toBeGreaterThan(100);
    expect(matText).toMatch(/\bChr\b/i);
    expect(patText).toMatch(/\bChr\b/i);
    expect(parseMapTsv(matText).has("chr1")).toBe(true);
    expect(parseMapTsv(matText).has("chr20")).toBe(true);
    expect(parseMapTsv(matText).has("chrY")).toBe(false);
    expect(parseMapTsv(patText).has("chr1")).toBe(true);
    expect(parseMapTsv(patText).has("chr20")).toBe(true);
    expect(parseMapTsv(patText).has("chrY")).toBe(false);
  });
});

describe("map prorating", () => {
  it("prorates cM for partial megabase overlaps", () => {
    // positions are midpoints of 1Mb bins (bp)
    const rows = [
      { pos: 500000, cMperMb: 10 }, // a
      { pos: 1500000, cMperMb: 20 }, // b
      { pos: 2500000, cMperMb: 30 }, // c
      { pos: 3500000, cMperMb: 40 }, // d
    ];

    const intervals = buildIntervals(rows);
    // example segment spans: 1,000,000 bp -> from 1,000,000 to 2,000,000 (or use whatever example you want)
    // Use the sample case from the conversation: overlaps 0.5Mb of first, 1Mb of second, 1Mb of third, 0.2Mb of fourth
    // We'll directly compute expected using the described weights:
    const expected = 0.5 * 10 + 1 * 20 + 1 * 30 + 0.2 * 40; // 5 + 20 + 30 + 8 = 63

    // Choose start/end that produce those overlaps across the constructed intervals.
    // For this interval layout, use start = 1000000 - 700000 and end = 3500000 - 300000 to reproduce weighting.
    // Simpler: compute cm across 1_000_000..3_600_000 which spans the central region used in the example.
    const start = 500000;
    const end = 3200000;

    const result = calculateSegmentCm(intervals, start, end);
    expect(result).toBeCloseTo(expected, 6);
  });
});
