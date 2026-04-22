export function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toOptionalNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return toNumber(text);
}

export function resolveChromosomeKey(rawChr, map) {
  const base = String(rawChr || "").trim();
  if (!base) return "";

  // normalize numeric X/Y
  const lower = base.toLowerCase();
  const numeric = Number(lower.replace(/^chr/, ""));
  const prefer = (n) => (n === 23 ? "chrx" : n === 24 ? "chry" : null);

  // exact match or with/without 'chr'

  if (map.has(base)) return base;
  const withChr = lower.startsWith("chr") ? lower : `chr${lower}`;

  for (const key of map.keys()) {
    const normKey = String(key || "").toLowerCase();
    if (normKey === lower || normKey === withChr) return key;
    // handle numeric->X/Y
    const altKey = prefer(numeric);
    if (altKey && normKey === altKey) return key;
  }

  return "";
}

export function normalizeChromosomeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// parseMapTsv, buildIntervals, and calculateSegmentCm
export function parseMapTsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (!lines.length) return new Map();

  const header = lines[0].split("\t");
  const findColumn = (name) =>
    header.findIndex((col) => String(col).toLowerCase() === name.toLowerCase());

  const chrIdx = findColumn("Chr");
  const posIdx = findColumn("pos");
  const cmRateIdx = findColumn("cMperMb");

  if (chrIdx === -1 || posIdx === -1 || cmRateIdx === -1) {
    throw new Error("TSV missing required columns (Chr, pos, cMperMb).");
  }

  const byChromosome = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split("\t");
    const chr = String(cols[chrIdx] || "").trim();
    const pos = toNumber(cols[posIdx]);
    const cMperMb = toNumber(cols[cmRateIdx]);

    if (!chr || pos === null || cMperMb === null) continue;

    if (!byChromosome.has(chr)) byChromosome.set(chr, []);
    byChromosome.get(chr).push({ pos, cMperMb });
  }

  for (const [chr, rows] of byChromosome.entries()) {
    rows.sort((a, b) => a.pos - b.pos);
    byChromosome.set(chr, buildIntervals(rows));
  }

  return byChromosome;
}

export function buildIntervals(rows) {
  if (!rows.length) return [];

  if (rows.length === 1) {
    const center = rows[0].pos;
    return [
      {
        start: Math.max(0, center - 500000),
        end: center + 500000,
        cMperMb: rows[0].cMperMb,
      },
    ];
  }

  const intervals = [];
  for (let i = 0; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const curr = rows[i];
    const next = rows[i + 1];

    const leftBoundary =
      i === 0
        ? Math.max(0, curr.pos - (next.pos - curr.pos) / 2)
        : (prev.pos + curr.pos) / 2;

    const rightBoundary =
      i === rows.length - 1
        ? curr.pos + (curr.pos - prev.pos) / 2
        : (curr.pos + next.pos) / 2;

    intervals.push({
      start: leftBoundary,
      end: rightBoundary,
      cMperMb: curr.cMperMb,
    });
  }

  return intervals;
}

export function calculateSegmentCm(intervals, start, end) {
  if (!intervals.length) return 0;

  const segmentStart = Math.min(start, end);
  const segmentEnd = Math.max(start, end);
  if (segmentEnd <= segmentStart) return 0;

  let cm = 0;
  for (const interval of intervals) {
    const overlapStart = Math.max(segmentStart, interval.start);
    const overlapEnd = Math.min(segmentEnd, interval.end);
    if (overlapEnd <= overlapStart) continue;

    const overlapBp = overlapEnd - overlapStart;
    cm += (overlapBp / 1e6) * interval.cMperMb;
  }

  return cm;
}
