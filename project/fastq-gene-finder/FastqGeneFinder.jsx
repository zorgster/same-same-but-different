import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FASTQ_GENE_FINDER_CONFIG } from "./fastq-gene-finder-config.js";
import DropZone from "../widgets/DropZone.jsx";
import PileupView from "./widgets/PileupView.jsx";
import CoverageOverview from "./widgets/CoverageOverview.jsx";
import ProcessControls from "./widgets/ProcessControls.jsx";
import ResultsView from "./widgets/ResultsView.jsx";
import {
  MostUniquesPanel,
  PerSeedSummaryPanel,
  TxSeedIndexPanel,
} from "./widgets/SeedsStatsPanel.jsx";
import SeedVisualization from "./widgets/SeedVisualization.jsx";
import GeneLookupWidget from "./widgets/GeneLookupWidget.jsx";
import * as Styles from "./styles/fastq-gene-finder-styles.jsx";
import MoreInfoWidget from "./widgets/MoreInfoWidget.jsx";
import { exportOverviewPdf, exportZoomWindowPdf } from "./utils/exportPdf.js";
import { buildGeneIndex, buildTxIndex } from "./utils/compactIndex.js";
import { Gunzip } from "fflate";

// Seeded PRNG (mulberry32): the same seed number always yields the same seed arrays.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseSeedNumber(value) {
  const n = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n >>> 0 : 1;
}

function makeSeedPositions(
  readLength,
  startFraction,
  endFraction,
  positionsPerArray,
  rng = Math.random,
) {
  const start = Math.max(0, Math.floor(readLength * startFraction));
  const end = Math.max(start + 1, Math.ceil(readLength * endFraction));
  const count = Math.min(positionsPerArray, end - start);
  const positions = [];
  let needed = count;
  let remaining = end - start;
  // Sequential sampling: adaptive probability guarantees exactly `count` positions
  // in one forward pass — no rejection retries, no sort needed.
  for (let i = start; i < end && needed > 0; i++, remaining--) {
    if (rng() < needed / remaining) {
      positions.push(i);
      needed--;
    }
  }
  return positions;
}

/* ============================================================
   STREAMING FASTQ.GZ PARSER (memory-safe)
============================================================ */
function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function gunzipStream() {
  let ctrl;
  const gz = new Gunzip((chunk) => ctrl.enqueue(chunk));
  return new TransformStream({
    start(c) { ctrl = c; },
    transform(chunk) { gz.push(chunk, false); },
    flush() { gz.push(new Uint8Array(0), true); },
  });
}

function getFastqReadableStream(
  file,
  onCompressedBytes,
  isCompressed = file.name.toLowerCase().endsWith(".gz"),
) {
  const raw = file.stream();
  if (isCompressed) {
    let count = 0;
    const counter = new TransformStream({
      transform(chunk, controller) {
        count += chunk.byteLength;
        onCompressedBytes?.(count);
        controller.enqueue(chunk);
      },
    });
    return raw
      .pipeThrough(counter)
      .pipeThrough(gunzipStream());
  }
  return raw;
}

async function readFirstFastqSequence(file) {
  const stream = getFastqReadableStream(file);
  const reader = stream.getReader();
  let lineCount = 0;
  let remainder = new Uint8Array(0);

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = remainder.length ? concat(remainder, value) : value;
    let segStart = 0;

    for (let pos = 0; pos < chunk.length; pos++) {
      if (chunk[pos] === 10) {
        // \n
        if (lineCount === 1) {
          // end of sequence line — trim \r for CRLF files
          let seqLen = pos - segStart;
          if (seqLen > 0 && chunk[pos - 1] === 13) seqLen--;
          await reader.cancel();
          return seqLen;
        }
        lineCount++;
        segStart = pos + 1;
      }
    }

    remainder = chunk.subarray(segStart);
  }

  throw new Error("Selected file does not contain a complete FASTQ record");
}

async function streamFastq({
  file,
  onRead,
  pauseRef,
  abortRef,
  onProgress,
  tick,
  batchSize = 200,
  readLength,
  waitForCapacity,
}) {
  const totalBytes = file.size;
  let bytesRead = 0;
  let compressedBytesRead = 0;
  const isCompressed = file.name.toLowerCase().endsWith(".gz");
  const stream = getFastqReadableStream(
    file,
    isCompressed ? (n) => { compressedBytesRead = n; } : null,
    isCompressed,
  );
  const reader = stream.getReader();

  let readIndex = 0;
  let remainder = new Uint8Array(0);
  let lastProgressReport = 0;

  try {
    while (true) {
      if (waitForCapacity) await waitForCapacity();
      const { value, done } = await reader.read();

      if (abortRef && abortRef.current) { await reader.cancel(); return { done: true }; }
      if (pauseRef && pauseRef.current) {
        while (pauseRef.current && !(abortRef && abortRef.current)) await tick();
        if (abortRef && abortRef.current) { await reader.cancel(); return { done: true }; }
      }

      if (value) {
        bytesRead += value.byteLength;
        if (onProgress) {
          const now = Date.now();
          if (now - lastProgressReport >= 100) {
            onProgress(isCompressed ? compressedBytesRead : bytesRead, totalBytes, file.name);
            lastProgressReport = now;
          }
        }
      }

      const chunk = remainder.length
        ? (value ? concat(remainder, value) : remainder)
        : (value ?? new Uint8Array(0));
      remainder = new Uint8Array(0);

      if (done && chunk.length < readLength) break;

      let pos = 0;
      let blockLength = 0;

      while (true) {
        const bytesAvail = chunk.length - pos;

        // Single upfront guard — replaces all per-step bounds checks inside the loop.
        // blockLength = 0 until first record is measured; use readLength*4 as a safe estimate.
        if (
          (blockLength === 0 && bytesAvail < readLength * 4) ||
          (done && bytesAvail < readLength) ||
          (blockLength > 0 && bytesAvail < blockLength + 10)
        ) { remainder = chunk.subarray(pos); break; }

        const recordStart = pos;

        // Line 0 — header: scan for \n (safe — upfront guard guarantees enough bytes)
        while (chunk[pos] !== 10) pos++;
        pos++; // past \n → seqStart

        // Line 1 — sequence: skip exactly readLength bytes + terminator
        const seqStart = pos;
        pos += readLength;
        if (chunk[pos] === 13) pos++;
        pos++; // past \n → plusStart

        // Line 2 — +: scan for \n (spec allows full header repeat here)
        while (chunk[pos] !== 10) pos++;
        pos++; // past \n → qualStart

        // Line 3 — quality: skip exactly readLength bytes + optional terminator
        pos += readLength;
        if (pos < chunk.length && chunk[pos] === 13) pos++;
        if (pos < chunk.length && chunk[pos] === 10) pos++;

        const thisBlockLength = pos - recordStart;
        if (thisBlockLength > blockLength) blockLength = thisBlockLength;

        try { onRead(chunk.subarray(seqStart, seqStart + readLength), readIndex); }
        catch (err) { console.error("onRead handler threw:", err); }
        readIndex++;
        if (readIndex % batchSize === 0) await tick();
      }

      if (done) break;
    }

    return { done: true };
  } finally {
    try { reader.releaseLock && reader.releaseLock(); } catch (e) { /* ignore */ }
  }
}

/* ============================================================
   SEED GENERATION + MATCHING
============================================================ */
function generateSeedArrays(
  readLength,
  seedNumber,
  positionsPerArray = FASTQ_GENE_FINDER_CONFIG.positionsPerSeedArray,
) {
  const rng = mulberry32(seedNumber);
  let seedId = 0;
  return FASTQ_GENE_FINDER_CONFIG.seedFamilies.flatMap((family) =>
    Array.from({ length: family.count }, () => ({
      id: seedId++,
      label: family.label,
      positions: makeSeedPositions(
        readLength,
        family.startFraction,
        family.endFraction,
        positionsPerArray,
        rng,
      ),
    })),
  );
}

// Build gene + transcript indices and their stats for a seed set (one place, used by
// gene lookup, seed-file load and seed-number changes).
function buildSeedData(seeds, sequence, info, txs, readLength, seqMode) {
  const indices = buildSeedIndices(sequence, readLength, seeds);
  let txData = null;
  let txIndexStats = null;
  if (seqMode === "RNA" && txs?.length && info) {
    txData = buildCombinedTxIndex(txs, sequence, info, readLength, seeds);
    txIndexStats = computeTxIndexStats(txData.indices, txData.exonMaps, txs);
  }
  return { indices, txData, txIndexStats, seedStats: computeSeedStats(indices, seeds) };
}

// Gene-side sparse-mer indices are built as compact typed arrays (utils/compactIndex.js).
// 2-bit encoding: A=0, T=1, C=2, G=3 (N/other=0)
const KEY_BITS_TO_CHAR = ["A", "T", "C", "G"];

function decodeNumericKey(key, len) {
  let s = "";
  let k = key;
  for (let i = 0; i < len; i++) {
    s = KEY_BITS_TO_CHAR[k & 3] + s;
    k = Math.floor(k / 4);
  }
  return s;
}


function buildSeedIndices(geneSequence, readLength, seedArrays) {
  return buildGeneIndex(geneSequence, readLength, seedArrays);
}

function buildCombinedTxIndex(transcripts, geneSequence, geneInfo, readLength, seedArrays) {
  const minus = geneInfo?.strand === -1;
  const toG = (cs, ce) =>
    minus
      ? [geneInfo.end - ce, geneInfo.end - cs + 1]
      : [cs - geneInfo.start, ce - geneInfo.start + 1];

  const exonMaps = new Map(); // Map<txId, [{txStart, txEnd, gStart}]>
  const txList = [];          // [{ txIdx, seq }] — spliced sequences to index

  for (let i = 0; i < transcripts.length; i++) {
    const t = transcripts[i];
    let seq = "";
    const exonMap = [];
    const sortedExons = minus
      ? [...t.exons].sort((a, b) => b.start - a.start)
      : [...t.exons].sort((a, b) => a.start - b.start);
    for (const exon of sortedExons) {
      const [gStart, gEnd] = toG(exon.start, exon.end);
      if (gEnd <= gStart || gStart < 0 || gEnd > geneSequence.length) continue;
      exonMap.push({ txStart: seq.length, txEnd: seq.length + (gEnd - gStart), gStart });
      seq += geneSequence.slice(gStart, gEnd);
    }
    if (seq.length < readLength) continue;
    exonMaps.set(i, exonMap);
    txList.push({ txIdx: i, seq });
  }
  const indices = buildTxIndex(txList, readLength, seedArrays);
  return { indices, exonMaps };
}

function computeTxIndexStats(indices, exonMaps, transcripts) {
  const numSeeds = indices.length;
  const statsMap = new Map();
  for (const [i, em] of exonMaps) {
    const t = transcripts[i];
    const splicedLen = em.length ? em[em.length - 1].txEnd : 0;
    statsMap.set(i, {
      txId: t.id,
      biotype: t.biotype,
      isCanonical: t.isCanonical,
      splicedLen,
      perSeed: Array.from({ length: numSeeds }, () => ({ uniqueKeys: 0, totalPositions: 0, txUniqueKeys: 0 })),
    });
  }
  for (let s = 0; s < numSeeds; s++) {
    const { starts, entTx, entCount } = indices[s];
    const nKeys = starts.length - 1;
    for (let k = 0; k < nKeys; k++) {
      const isTxUnique = starts[k + 1] - starts[k] === 1;
      for (let e = starts[k]; e < starts[k + 1]; e++) {
        const st = statsMap.get(entTx[e]);
        if (st) {
          st.perSeed[s].uniqueKeys++;
          st.perSeed[s].totalPositions += entCount[e];
          if (isTxUnique) st.perSeed[s].txUniqueKeys++;
        }
      }
    }
  }
  return [...statsMap.values()].map((t) => ({
    ...t,
    txUniqueTotalKeys: t.perSeed.reduce((sum, p) => sum + p.txUniqueKeys, 0),
  }));
}

function computeSeedStats(seedIndices, seedArrays, topN = 5) {
  const perSeedStats = [];
  const top = [];

  for (let seedIdx = 0; seedIdx < seedIndices.length; seedIdx++) {
    const { keys, starts, positions } = seedIndices[seedIdx];
    const seed = seedArrays[seedIdx];
    const stats = {
      seedId: seed.id,
      seedLabel: seed.label,
      distinctSamples: 0,
      singletonCount: 0,
      totalAlignments: 0,
    };
    perSeedStats.push(stats);

    for (let k = 0; k < keys.length; k++) {
      const count = starts[k + 1] - starts[k];
      stats.distinctSamples++;
      stats.totalAlignments += count;
      if (count === 1) stats.singletonCount++;

      const firstPositions = Array.from(positions.subarray(starts[k], Math.min(starts[k + 1], starts[k] + 20)));
      const item = { seedId: seed.id, seedLabel: seed.label, rawKey: keys[k], keyLen: seed.positions.length, count, positions: firstPositions };
      if (top.length < topN) {
        top.push(item);
        top.sort((a, b) => b.count - a.count);
      } else if (item.count < top[0].count || (item.count === top[0].count && item.seedId < top[0].seedId)) {
        top[0] = item;
        top.sort((a, b) => b.count - a.count);
      }
    }
  }

  return {
    perSeedStats,
    topUniqueSamples: top
      .map((s) => ({ ...s, sampleKey: decodeNumericKey(s.rawKey, s.keyLen) }))
      .sort((a, b) => a.count - b.count),
  };
}

/* ============================================================
   PAIR VALIDATION (module-level, no hooks)
============================================================ */
function buildValidatedPairs(
  r1MatchMap,
  r2Matches,
  { minInsert, maxInsert, rnaMode, readLength },
) {
  const pairs = [];
  const greyedR1 = [];
  const r2ByIndex = new Map();

  for (const r2 of r2Matches) {
    const bucket = r2ByIndex.get(r2.index) ?? [];
    bucket.push(r2);
    r2ByIndex.set(r2.index, bucket);
  }

  for (const [, r1] of r1MatchMap) {
    const candidates = r2ByIndex.get(r1.index);
    if (!candidates?.length) {
      greyedR1.push({ ...r1, pairedStatus: "unconfirmed" });
      continue;
    }

    let best;
    if (rnaMode) {
      // Pick candidate closest to either end of R1
      const r1Start = r1.position ?? 0;
      const r1End = r1Start + (readLength ?? 100);
      best = candidates.reduce((a, b) => {
        const aPos = a.position ?? 0;
        const bPos = b.position ?? 0;
        const aDist = Math.min(
          Math.abs(aPos - r1Start),
          Math.abs(aPos - r1End),
        );
        const bDist = Math.min(
          Math.abs(bPos - r1Start),
          Math.abs(bPos - r1End),
        );
        return aDist <= bDist ? a : b;
      });
    } else {
      best = candidates.find((r2) => {
        const r1Pos = r1.position ?? 0;
        const r2Pos = r2.position ?? 0;
        const d = Math.abs(r2Pos - r1Pos);
        return (
          d >= minInsert && d <= maxInsert && r1.orientation !== r2.orientation
        );
      });
    }

    if (best) {
      const r1Pos = r1.position ?? 0;
      const r2Pos = best.position ?? 0;
      pairs.push({ r1, r2: best, insertSize: Math.abs(r2Pos - r1Pos) });
    } else {
      greyedR1.push({ ...r1, pairedStatus: "unconfirmed" });
    }
  }

  return { pairs, greyedR1 };
}

/* ============================================================
   MAIN COMPONENT: FastqGeneFinder
============================================================ */
export default function FastqGeneFinderApp() {
  const [files, setFiles] = useState([]);
  const [r2File, setR2File] = useState(null);
  const [seqMode, setSeqMode] = useState("DNA");
  const [geneName, setGeneName] = useState("");
  // Seeds: a seed number (deterministic PRNG) or a loaded seeds JSON, chosen before or after gene lookup
  const [seedNumber, setSeedNumber] = useState(() => String(Math.floor(Math.random() * 1_000_000)));
  const [loadedSeedFile, setLoadedSeedFile] = useState(null); // { name, readLength, seedNumber, seedArrays }
  const [seedSource, setSeedSource] = useState(null);         // { type: "number", value } | { type: "file", name, seedNumber }
  const [geneSequence, setGeneSequence] = useState("");
  const [geneInfo, setGeneInfo] = useState(null);
  const [maskedGeneSeq, setMaskedGeneSeq] = useState(null);
  const [transcripts, setTranscripts] = useState(null);
  const [txEvidenceCounts, setTxEvidenceCounts] = useState(new Map());
  const [txIndexStats, setTxIndexStats] = useState(null);
  const txDataRef = useRef([]);
  const [readLength, setReadLength] = useState(null);
  const [seedArrays, setSeedArrays] = useState([]);
  const [matchingReads, setMatchingReads] = useState([]);
  const [r2Matches, setR2Matches] = useState([]);
  const [validatedPairs, setValidatedPairs] = useState([]);
  const [greyedR1Reads, setGreyedR1Reads] = useState([]);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const coverageRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, fileName: "" });
  const [keptCount, setKeptCount] = useState(0);
  const [discardedCount, setDiscardedCount] = useState(0);
  const [processingFinished, setProcessingFinished] = useState(false);
  const pileupWindowSizes = [100, 125, 150, 175, 200, 225, 250];
  const [pileupWindowSize, setPileupWindowSize] = useState(150);
  const [pileupWindowStart, setPileupWindowStart] = useState(0);
  const [matchThresholdPct, setMatchThresholdPct] = useState(50);
  const [pileupThresholdPct, setPileupThresholdPct] = useState(70);
  const [seedStats, setSeedStats] = useState({
    perSeedStats: [],
    topUniqueSamples: [],
  });
  const [workerCount, setWorkerCount] = useState(() =>
    Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2) - 1),
  );
  const [workerStates, setWorkerStates] = useState([]);
  const [activeTab, setActiveTab] = useState("seeds");

  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  const indicesRef = useRef(null);
  const workersRef = useRef([]);
  const batchesDispatchedRef = useRef(0);
  const batchesReturnedRef = useRef(0);
  const streamDoneRef = useRef(false);
  const pendingBatchRef = useRef([]); // queue of pre-packaged batch arrays
  const currentBatchRef = useRef([]); // batch being assembled
  const idleWorkersRef = useRef([]);
  const pendingMatchesRef = useRef([]); // match accumulator — flushed to state at most 2×/s
  const nextBatchIdRef = useRef(0);
  const totalReadsRef = useRef(0);
  const startTimeRef = useRef(null);
  const pauseStartTimeRef = useRef(null);
  const totalPausedMsRef = useRef(0);
  const r1MatchMapRef = useRef(null);
  const seedLoadInputRef = useRef(null);

  const [, setTimerTick] = useState(0);
  const [finalElapsedMs, setFinalElapsedMs] = useState(null);
  const [r1Stats, setR1Stats] = useState(null); // frozen after R1 completes
  const [r2KeptCount, setR2KeptCount] = useState(0);

  // Derived insert range from seqMode
  const minInsert = 50;
  const maxInsert = seqMode === "RNA" ? 1_000_000 : 1000;

  const txEvidence = useMemo(() => {
    if (!txEvidenceCounts.size) return null;
    const total = Math.max(1, [...txEvidenceCounts.values()].reduce((s, n) => s + n, 0));
    return new Map([...txEvidenceCounts].map(([id, n]) => [id, { count: n, fraction: n / total }]));
  }, [txEvidenceCounts]);

  useEffect(() => {
    return () => {
      workersRef.current.forEach((w) => w.terminate());
      workersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (status !== "processing" && status !== "processing-r2") return;
    const id = setInterval(() => setTimerTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [status]);

  const elapsedMs =
    finalElapsedMs != null
      ? finalElapsedMs
      : startTimeRef.current != null
        ? Math.max(
            0,
            Date.now() -
              startTimeRef.current -
              totalPausedMsRef.current -
              (pauseStartTimeRef.current != null
                ? Date.now() - pauseStartTimeRef.current
                : 0),
          )
        : 0;
  const totalReadsDisplay = totalReadsRef.current;
  const readsPerSec =
    elapsedMs > 500 && totalReadsDisplay > 0
      ? Math.round(totalReadsDisplay / (elapsedMs / 1000))
      : null;

  const tick = () => new Promise((r) => setTimeout(r, 0));

  const canProcess =
    !!files.length &&
    !!geneSequence &&
    !!readLength &&
    !!seedArrays.length &&
    !["processing", "processing-r2", "pairing"].includes(status);

  /* ---------------- Pileup (only active after processing completes) ---------------- */
  const pileupStep = 25;
  const pileupMinScore = Math.max(
    1,
    Math.ceil(((seedArrays?.length || 1) * pileupThresholdPct) / 100),
  );

  const pairedMode = !!(
    r2File &&
    (validatedPairs.length > 0 || greyedR1Reads.length > 0)
  );

  // Single-end pileup reads (used in non-paired mode and for navigation)
  const singlePileupReads = processingFinished
    ? matchingReads.filter((read) => (read.score ?? 0) >= pileupMinScore)
    : [];

  // For pileup navigation: a flat list of read positions covering all modes
  const pileupReads = pairedMode
    ? [...validatedPairs.map((p) => p.r1), ...greyedR1Reads].filter(
        (r) => (r.score ?? 0) >= pileupMinScore,
      )
    : singlePileupReads;

  const pileupValidatedPairs = pairedMode
    ? validatedPairs.filter((p) => (p.r1.score ?? 0) >= pileupMinScore)
    : [];

  const pileupGreyedR1 = pairedMode
    ? greyedR1Reads.filter((r) => (r.score ?? 0) >= pileupMinScore)
    : [];

  const getReadStart = (read) => read.position;

  const movePileupWindow = (direction) => {
    if (!processingFinished) return;
    const maxStart = Math.max(0, geneSequence.length - pileupWindowSize);
    setPileupWindowStart((current) =>
      Math.max(0, Math.min(maxStart, current + direction * pileupStep)),
    );
  };

  const jumpPileupToStart = () => {
    if (!processingFinished) return;
    setPileupWindowStart(0);
  };

  const jumpPileupToEnd = () => {
    if (!processingFinished) return;
    setPileupWindowStart(Math.max(0, geneSequence.length - pileupWindowSize));
  };

  const jumpPileupToFirstMatch = () => {
    if (!processingFinished) return;
    const starts = pileupReads
      .map(getReadStart)
      .filter((pos) => Number.isFinite(pos));

    if (!starts.length) return;

    const earliest = Math.min(...starts);
    const maxStart = Math.max(0, geneSequence.length - pileupWindowSize);
    setPileupWindowStart(Math.max(0, Math.min(maxStart, earliest)));
  };

  const jumpPileupToNextMatch = () => {
    if (!processingFinished) return;
    const starts = pileupReads
      .map(getReadStart)
      .filter((pos) => Number.isFinite(pos));

    if (!starts.length) return;

    const windowEnd = Math.min(
      geneSequence.length,
      pileupWindowStart + pileupWindowSize,
    );

    const forward = starts.filter((s) => s >= windowEnd);
    let target;
    if (forward.length) {
      target = Math.min(...forward);
    } else {
      const later = starts.filter((s) => s > pileupWindowStart);
      if (later.length) target = Math.min(...later);
      else target = Math.max(0, geneSequence.length - pileupWindowSize);
    }

    const maxStart = Math.max(0, geneSequence.length - pileupWindowSize);
    setPileupWindowStart(Math.max(0, Math.min(maxStart, target)));
  };

  const seedControlsDisabled = ["processing", "processing-r2", "pairing", "paused"].includes(status);

  // Builds indices + stats once for a seed set and stores them.
  function applySeedData(seeds, sequence, info, txs) {
    const data = buildSeedData(seeds, sequence, info, txs, readLength, seqMode);
    setSeedArrays(seeds);
    indicesRef.current = data.indices;
    txDataRef.current = data.txData;
    setTxIndexStats(data.txIndexStats);
    setSeedStats(data.seedStats);
  }

  // Regenerate seeds from a seed number when a gene is already loaded (Enter / Random / Apply / clear file).
  function regenerateFromSeedNumber(value) {
    if (!geneSequence || !readLength) return;
    const n = parseSeedNumber(value);
    const seeds = generateSeedArrays(readLength, n);
    setSeedSource({ type: "number", value: n });
    applySeedData(seeds, geneSequence, geneInfo, transcripts);
  }

  function handleRandomSeed() {
    const value = String(Math.floor(Math.random() * 1_000_000));
    setSeedNumber(value);
    setLoadedSeedFile(null);
    regenerateFromSeedNumber(value);
  }

  function handleClearSeedFile() {
    setLoadedSeedFile(null);
    regenerateFromSeedNumber(seedNumber);
  }

  const handleGeneSequenceLoaded = useCallback(
    (sequence, info, maskedSeq, newTranscripts) => {
      setGeneSequence(sequence);
      setGeneInfo(info || null);
      setMaskedGeneSeq(maskedSeq ?? null);
      setTranscripts(newTranscripts ?? null);
      setTxEvidenceCounts(new Map());
      setTxIndexStats(null);
      setMatchingReads([]);
      setR2Matches([]);
      setValidatedPairs([]);
      setGreyedR1Reads([]);
      setActiveTab("seeds");

      if (readLength) {
        // Use a seeds JSON loaded beforehand if it fits this read length; otherwise the seed number.
        let seeds;
        if (loadedSeedFile && loadedSeedFile.readLength === readLength) {
          seeds = loadedSeedFile.seedArrays;
          setSeedSource({ type: "file", name: loadedSeedFile.name, seedNumber: loadedSeedFile.seedNumber });
        } else {
          if (loadedSeedFile) {
            alert(`Seed file ${loadedSeedFile.name} was built for readLength=${loadedSeedFile.readLength}, but reads are ${readLength} bp. Using seed number ${seedNumber} instead.`);
            setLoadedSeedFile(null);
          }
          const n = parseSeedNumber(seedNumber);
          seeds = generateSeedArrays(readLength, n);
          setSeedSource({ type: "number", value: n });
        }
        applySeedData(seeds, sequence, info, newTranscripts);
        setStatus("ready-to-process");
      } else {
        setSeedArrays([]);
        txDataRef.current = [];
        setStatus("awaiting-read-length");
      }
    },
    [readLength, seqMode, loadedSeedFile, seedNumber],
  );

  const handleGeneLookupFailed = useCallback(() => {
    setGeneSequence("");
    setGeneInfo(null);
    setMaskedGeneSeq(null);
    setSeedArrays([]);
    setSeedSource(null);
    setMatchingReads([]);
    setR2Matches([]);
    setValidatedPairs([]);
    setGreyedR1Reads([]);
    txDataRef.current = [];
    setTxIndexStats(null);
    setStatus(files.length ? "awaiting-gene" : "idle");
  }, [files.length]);

  /* ---------------- File selection ---------------- */
  const initR1File = useCallback((file) => {
    setStatus("reading-file");
    setMatchingReads([]);
    setR2Matches([]);
    setValidatedPairs([]);
    setGreyedR1Reads([]);
    r1MatchMapRef.current = null;
    setProgress({ done: 0, total: 0, fileName: file.name });
    pauseRef.current = false;
    abortRef.current = false;
    setGeneSequence("");
    setSeedArrays([]);
    setSeedSource(null);

    setTimeout(async () => {
      try {
        const seqLen = await readFirstFastqSequence(file);
        setReadLength(seqLen);
        setStatus("awaiting-gene");
      } catch {
        setReadLength(null);
        setStatus("error");
      }
    }, 0);
  }, []);

  const handleFilesSelected = useCallback(
    (selected) => {
      if (selected.length === 2) {
        const [a, b] = selected;
        const r1Pat = /_R1[_.]|_1\./i;
        const r2Pat = /_R2[_.]|_2\./i;
        if (r1Pat.test(a.name) && r2Pat.test(b.name)) {
          setFiles([a]);
          setR2File(b);
          initR1File(a);
          return;
        }
        if (r1Pat.test(b.name) && r2Pat.test(a.name)) {
          setFiles([b]);
          setR2File(a);
          initR1File(b);
          return;
        }
      }
      setFiles(selected);
      setR2File(null);
      if (!selected.length) return;
      initR1File(selected[0]);
    },
    [initR1File],
  );

  const handleR2FileSelected = useCallback((selected) => {
    setR2File(selected[0] || null);
  }, []);

  /* ---------------- Processing ---------------- */
  const BATCH_SIZE = 50000;

  const failRun = (err) => {
    console.error("FASTQ processing failed:", err);
    abortRef.current = true;                // stops streamFastq and waitForCapacity
    workersRef.current.forEach((w) => w.terminate());
    workersRef.current = [];
    pendingBatchRef.current = [];
    currentBatchRef.current = [];
    idleWorkersRef.current = [];
    setFinalElapsedMs(
      startTimeRef.current != null
        ? Date.now() - startTimeRef.current - totalPausedMsRef.current
        : 0,
    );
    setProcessingFinished(true);            // R1 results stay viewable
    setStatus("error");
    // optional: setErrorMessage(err?.message ?? String(err)) and show it beside the status
  };

  const handleProcess = useCallback(async () => {
    if (!files.length || !geneSequence || !seedArrays.length) return;

    const file = files[0];
    const currentR2File = r2File; // capture for this processing run
    const currentTranscripts = transcripts;

    setStatus("processing");
    setProcessingFinished(false);
    setMatchingReads([]);
    setR2Matches([]);
    setValidatedPairs([]);
    setGreyedR1Reads([]);
    setTxEvidenceCounts(new Map());
    r1MatchMapRef.current = null;
    setR1Stats(null);
    setR2KeptCount(0);
    setKeptCount(0);
    setDiscardedCount(0);
    pauseRef.current = false;
    abortRef.current = false;

    batchesDispatchedRef.current = 0;
    batchesReturnedRef.current = 0;
    streamDoneRef.current = false;
    pendingBatchRef.current = [];
    currentBatchRef.current = [];
    idleWorkersRef.current = [];
    pendingMatchesRef.current = [];
    nextBatchIdRef.current = 0;
    totalReadsRef.current = 0;
    startTimeRef.current = Date.now();
    pauseStartTimeRef.current = null;
    totalPausedMsRef.current = 0;
    setFinalElapsedMs(null);

    const seedIndices = indicesRef.current;
    const minSeedMatches = Math.max(
      1,
      Math.ceil(((seedArrays?.length || 1) * matchThresholdPct) / 100),
    );
    const actualWorkerCount = Math.max(1, workerCount);

    setWorkerStates(
      Array.from({ length: actualWorkerCount }, (_, i) => ({
        id: i,
        status: "idle",
        batchesDone: 0,
        matchesFound: 0,
      })),
    );

    // Spawn workers
    const workers = Array.from(
      { length: actualWorkerCount },
      () =>
        new Worker(new URL("./fastq-search.worker.js", import.meta.url), {
          type: "module",
        }),
    );
    workersRef.current = workers;

    const dispatchBatch = (workerIdx) => {
      const reads = pendingBatchRef.current.shift();
      const batchId = nextBatchIdRef.current++;
      const send = (r) =>
        workers[workerIdx].postMessage({
          type: "batch",
          payload: { batchId, reads },
        });
      
      try {
        send(reads);
      } catch (err) {
        if (err?.name === "DataCloneError") return failRun(err);
        // Views pin their whole source chunks; retry with 150-byte copies.
        try {
          send(reads.map(({ seqBytes, index }) => ({ seqBytes: seqBytes.slice(), index })));
          console.warn(`Batch $(batchId): clone failed, re-sent as compact copies`);
        } catch (err2) {
          return failRun(err2);
        }
      }
      batchesDispatchedRef.current++;
    };

    const drainPendingBatches = () => {
      while (
        pendingBatchRef.current.length > 0 &&
        idleWorkersRef.current.length > 0
      ) {
        const workerIdx = idleWorkersRef.current.shift();
        dispatchBatch(workerIdx);
      }
    };

    const flushFinalBatch = () => {
      if (currentBatchRef.current.length > 0) {
        pendingBatchRef.current.push(currentBatchRef.current);
        currentBatchRef.current = [];
      }
      while (
        pendingBatchRef.current.length > 0 &&
        idleWorkersRef.current.length > 0
      ) {
        const workerIdx = idleWorkersRef.current.shift();
        dispatchBatch(workerIdx);
      }
    };

    const checkDone = () => {
      if (
        streamDoneRef.current &&
        currentBatchRef.current.length === 0 &&
        pendingBatchRef.current.length === 0 &&
        batchesDispatchedRef.current === batchesReturnedRef.current
      ) {
        workersRef.current.forEach((w) => w.terminate());
        workersRef.current = [];
        syncMatchDisplay(true); // flush any buffered matches before marking done
        setFinalElapsedMs(
          startTimeRef.current != null
            ? Date.now() - startTimeRef.current - totalPausedMsRef.current
            : 0,
        );
        setWorkerStates((prev) => prev.map((w) => ({ ...w, status: "done" })));
        setProcessingFinished(true);
        // If R2 file is present, signal R2 pass; otherwise fully done
        setStatus(currentR2File ? "done-r1" : "done");
      }
    };

    // Per-worker counters (plain arrays, closed over by handlers) — synced to display at most 10×/s
    const workerBatchDone = new Array(actualWorkerCount).fill(0);
    const workerMatchFound = new Array(actualWorkerCount).fill(0);
    let lastWorkerStateSync = 0;
    let lastMatchFlush = 0;

    const syncWorkerDisplay = () => {
      const now = Date.now();
      if (now - lastWorkerStateSync >= 100) {
        lastWorkerStateSync = now;
        setWorkerStates((prev) =>
          prev.map((ws) => ({
            ...ws,
            batchesDone: workerBatchDone[ws.id],
            matchesFound: workerMatchFound[ws.id],
          })),
        );
      }
    };

    const syncMatchDisplay = (force = false) => {
      const now = Date.now();
      if (
        (force || now - lastMatchFlush >= 500) &&
        pendingMatchesRef.current.length > 0
      ) {
        lastMatchFlush = now;
        const toAdd = pendingMatchesRef.current;
        pendingMatchesRef.current = [];
        setMatchingReads((prev) => prev.concat(toAdd));
        setKeptCount((prev) => prev + toAdd.length);
      }
    };

    // Wire message handlers and count ready workers
    let readyCount = 0;
    let resolveAllReady;
    const allReadyPromise = new Promise((res) => {
      resolveAllReady = res;
    });

    workers.forEach((w, i) => {
      w.onmessage = ({ data }) => {
        if (data.type === "ready") {
          idleWorkersRef.current.push(i);
          readyCount++;
          if (readyCount === actualWorkerCount) resolveAllReady();
          return;
        }

        if (data.type === "result") {
          batchesReturnedRef.current++;
          const { matches } = data;
          workerBatchDone[i]++;
          if (matches.length > 0) {
            workerMatchFound[i] += matches.length;
            // Translate integer txIdx → ENST string at the display boundary
            const updates = new Map();
            for (const m of matches) {
              if (m.source != null) m.source = currentTranscripts[m.source].id;
              for (const ev of (m.txEvidence || [])) {
                const txId = currentTranscripts[ev.txIdx]?.id;
                if (txId) updates.set(txId, (updates.get(txId) || 0) + 1);
              }
            }
            pendingMatchesRef.current.push(...matches);
            if (updates.size > 0) {
              setTxEvidenceCounts((prev) => {
                const next = new Map(prev);
                for (const [txId, n] of updates) next.set(txId, (next.get(txId) || 0) + n);
                return next;
              });
            }
          }
          syncWorkerDisplay();
          syncMatchDisplay();
          idleWorkersRef.current.push(i);
          drainPendingBatches();
          checkDone();
          return;
        }

        if (data.type === "error") {
          batchesReturnedRef.current++;
          setWorkerStates((prev) =>
            prev.map((ws) => (ws.id === i ? { ...ws, status: "error" } : ws)),
          );
          idleWorkersRef.current.push(i);
          drainPendingBatches();
          checkDone();
        }
      };

      w.onerror = () => {
        batchesReturnedRef.current++;
        setWorkerStates((prev) =>
          prev.map((ws) => (ws.id === i ? { ...ws, status: "error" } : ws)),
        );
        idleWorkersRef.current.push(i);
        drainPendingBatches();
        checkDone();
      };
    });

    // Init all workers
    workers.forEach((w) =>
      w.postMessage({
        type: "init",
        payload: {
          seedArrays,
          seedIndices,
          minSeedMatches,
          txData: txDataRef.current,
        },
      }),
    );
    await allReadyPromise;

    // Stream FASTQ, accumulate reads into batches
    try {
      await streamFastq({
        file,
        readLength,
        batchSize: BATCH_SIZE,
        onRead: (seqBytes, index) => {
          totalReadsRef.current++;
          currentBatchRef.current.push({ seqBytes, index });
          if (currentBatchRef.current.length >= BATCH_SIZE) {
            pendingBatchRef.current.push(currentBatchRef.current);
            currentBatchRef.current = [];
            drainPendingBatches();
          }
        },
        pauseRef,
        abortRef,
        onProgress: (done, total, fileName) =>
          setProgress({ done, total, fileName }),
        tick,
        waitForCapacity: async () => {
          while (pendingBatchRef.current.length >= actualWorkerCount * 2 && !abortRef.current)
            await tick();
        }
      });
  } catch (err) {
    failRun(err);
    return;
  }

    streamDoneRef.current = true;

    if (abortRef.current) {
      // handleAbort already terminated workers and set status
      return;
    }

    flushFinalBatch();
    checkDone();
  }, [
    files,
    geneSequence,
    seedArrays,
    readLength,
    workerCount,
    matchThresholdPct,
    r2File,
    transcripts,
  ]);

  /* ---------------- R2 pass (triggered after R1 completes with r2File set) ---------------- */
  const runR2Pass = useCallback(async () => {
    if (!r2File || !indicesRef.current || !r1MatchMapRef.current) return;

    const r2Map = r1MatchMapRef.current;
    const currentTranscripts = transcripts;
    setStatus("processing-r2");
    setProgress({ done: 0, total: 0, fileName: r2File.name });
    setR2KeptCount(0);
    setFinalElapsedMs(null);
    startTimeRef.current = Date.now();
    pauseStartTimeRef.current = null;
    totalPausedMsRef.current = 0;
    pauseRef.current = false;

    batchesDispatchedRef.current = 0;
    batchesReturnedRef.current = 0;
    streamDoneRef.current = false;
    pendingBatchRef.current = [];
    currentBatchRef.current = [];
    idleWorkersRef.current = [];
    nextBatchIdRef.current = 0;

    const r2Accumulated = [];
    let lastR2Sync = 0;
    const syncR2Display = () => {
      const now = Date.now();
      if (now - lastR2Sync >= 500) {
        lastR2Sync = now;
        setR2KeptCount(r2Accumulated.length);
      }
    };

    const seedIndices = indicesRef.current;
    const minSeedMatches = Math.max(
      1,
      Math.ceil(((seedArrays.length || 1) * matchThresholdPct) / 100),
    );
    const actualWorkerCount = Math.max(1, workerCount);

    const workers = Array.from(
      { length: actualWorkerCount },
      () =>
        new Worker(new URL("./fastq-search.worker.js", import.meta.url), {
          type: "module",
        }),
    );
    workersRef.current = workers;

    const dispatchBatch = (workerIdx) => {
      const reads = pendingBatchRef.current.shift();
      const batchId = nextBatchIdRef.current++;
      const send = (r) =>
        workers[workerIdx].postMessage({
          type: "batch",
          payload: { batchId, reads },
        });
      
      try {
        send(reads);
      } catch (err) {
        if (err?.name === "DataCloneError") return failRun(err);
        // Views pin their whole source chunks; retry with 150-byte copies.
        try {
          send(reads.map(({ seqBytes, index }) => ({ seqBytes: seqBytes.slice(), index })));
          console.warn(`Batch $(batchId): clone failed, re-sent as compact copies`);
        } catch (err2) {
          return failRun(err2);
        }
      }
      batchesDispatchedRef.current++;
    };

    const drainPendingBatches = () => {
      while (
        pendingBatchRef.current.length > 0 &&
        idleWorkersRef.current.length > 0
      ) {
        const workerIdx = idleWorkersRef.current.shift();
        dispatchBatch(workerIdx);
      }
    };

    const currentSeqMode = seqMode;
    const currentReadLength = readLength;
    const currentMinInsert = minInsert;
    const currentMaxInsert = maxInsert;

    const checkDoneR2 = () => {
      if (
        streamDoneRef.current &&
        currentBatchRef.current.length === 0 &&
        pendingBatchRef.current.length === 0 &&
        batchesDispatchedRef.current === batchesReturnedRef.current
      ) {
        workersRef.current.forEach((w) => w.terminate());
        workersRef.current = [];
        setFinalElapsedMs(
          startTimeRef.current != null ? Date.now() - startTimeRef.current : 0,
        );
        setR2KeptCount(r2Accumulated.length);

        // Run pairing validation
        const { pairs, greyedR1 } = buildValidatedPairs(r2Map, r2Accumulated, {
          minInsert: currentMinInsert,
          maxInsert: currentMaxInsert,
          rnaMode: currentSeqMode === "RNA",
          readLength: currentReadLength,
        });

        setR2Matches(r2Accumulated.slice());
        setValidatedPairs(pairs);
        setGreyedR1Reads(greyedR1);
        setProcessingFinished(true);
        setStatus("done");
      }
    };

    let readyCount = 0;
    let resolveAllReady;
    const allReadyPromise = new Promise((res) => {
      resolveAllReady = res;
    });

    workers.forEach((w, i) => {
      w.onmessage = ({ data }) => {
        if (data.type === "ready") {
          idleWorkersRef.current.push(i);
          readyCount++;
          if (readyCount === actualWorkerCount) resolveAllReady();
          return;
        }
        if (data.type === "result") {
          batchesReturnedRef.current++;
          const { matches } = data;
          if (matches.length > 0) {
            for (const m of matches) {
              if (m.source != null) m.source = currentTranscripts[m.source].id;
            }
            r2Accumulated.push(...matches);
          }
          syncR2Display();
          idleWorkersRef.current.push(i);
          drainPendingBatches();
          checkDoneR2();
        }
        if (data.type === "error") {
          batchesReturnedRef.current++;
          idleWorkersRef.current.push(i);
          drainPendingBatches();
          checkDoneR2();
        }
      };
      w.onerror = () => {
        batchesReturnedRef.current++;
        idleWorkersRef.current.push(i);
        drainPendingBatches();
        checkDoneR2();
      };
    });

    workers.forEach((w) =>
      w.postMessage({
        type: "init",
        payload: {
          seedArrays,
          seedIndices,
          minSeedMatches,
          txData: txDataRef.current,
        },
      }),
    );
    await allReadyPromise;

    try {
      await streamFastq({
        file: r2File,
        readLength,
        batchSize: BATCH_SIZE,
        onRead: (seqBytes, index) => {
          if (!r2Map.has(index)) return; // skip reads whose R1 did not match
          currentBatchRef.current.push({ seqBytes: seqBytes.slice(), index });
          if (currentBatchRef.current.length >= BATCH_SIZE) {
            pendingBatchRef.current.push(currentBatchRef.current);
            currentBatchRef.current = [];
            drainPendingBatches();
          }
        },
        pauseRef,
        abortRef,
        onProgress: (done, total, fileName) =>
          setProgress({ done, total, fileName }),
        tick,
        waitForCapacity: async () => {
          while (pendingBatchRef.current.length >= actualWorkerCount * 2 && !abortRef.current)
            await tick();
        }
      });
    } catch (err) {
      failRun(err);
      return;
    }

    streamDoneRef.current = true;

    if (abortRef.current) return;

    if (currentBatchRef.current.length > 0) {
      pendingBatchRef.current.push(currentBatchRef.current);
      currentBatchRef.current = [];
    }
    drainPendingBatches();
    checkDoneR2();
  }, [
    r2File,
    seedArrays,
    workerCount,
    matchThresholdPct,
    seqMode,
    readLength,
    minInsert,
    maxInsert,
    transcripts,
  ]);

  // Trigger R2 pass when R1 completes with an R2 file set.
  // matchingReads is final at this point — R1's checkDone() called syncMatchDisplay(true)
  // then setStatus("done-r1") in the same React batch, so this effect sees the final matches.
  useEffect(() => {
    if (status !== "done-r1") return;
    if (!r2File) {
      setStatus("done");
      return;
    }

    // Freeze R1 stats for comparison display
    const r1TotalReads = totalReadsRef.current;
    const r1Kept = matchingReads.length;
    setR1Stats({
      fileName: progress.fileName,
      fileSizeDone: progress.done,
      fileSizeTotal: progress.total,
      totalReads: r1TotalReads,
      keptCount: r1Kept,
      elapsedMs: finalElapsedMs ?? 0,
      readsPerSec:
        r1TotalReads > 0 && (finalElapsedMs ?? 0) > 0
          ? Math.round(r1TotalReads / ((finalElapsedMs ?? 1) / 1000))
          : null,
    });

    // Sort R1 matches by FASTQ line number (workers finish out of order)
    const sorted = [...matchingReads].sort(
      (a, b) => (a.fastqSequenceLine ?? 0) - (b.fastqSequenceLine ?? 0),
    );
    r1MatchMapRef.current = new Map(sorted.map((m) => [m.index, m]));

    setTimeout(() => {
      runR2Pass();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handlePauseResume = () => {
    if (status === "processing") {
      pauseRef.current = true;
      pauseStartTimeRef.current = Date.now();
      setStatus("paused");
    } else if (status === "paused") {
      pauseRef.current = false;
      if (pauseStartTimeRef.current != null) {
        totalPausedMsRef.current += Date.now() - pauseStartTimeRef.current;
        pauseStartTimeRef.current = null;
      }
      setStatus("processing");
    }
  };

  const handleAbort = () => {
    abortRef.current = true;
    workersRef.current.forEach((w) => {
      w.postMessage({ type: "abort" });
      w.terminate();
    });
    workersRef.current = [];
    pendingBatchRef.current = [];
    currentBatchRef.current = [];
    idleWorkersRef.current = [];
    setFinalElapsedMs(
      startTimeRef.current != null
        ? Date.now() - startTimeRef.current - totalPausedMsRef.current
        : 0,
    );
    setProcessingFinished(true);
    setStatus("aborted");
  };

  /* ---------------- Render ---------------- */
  const TABS = [
    { key: "seeds", label: "Seeds" },
    {
      key: "reads",
      label: `Matched Reads${matchingReads.length ? ` (${matchingReads.length})` : ""}`,
    },
    { key: "qc", label: "QC" },
    { key: "pileup", label: "Pileup" },
  ];

  const tabBarStyle = {
    display: "flex",
    borderBottom: "2px solid #444",
    marginTop: "1rem",
    gap: "3px",
    alignItems: "flex-end",
  };

  const tabBtnStyle = (active) => ({
    padding: "0.35rem 1rem",
    border: "1px solid",
    borderColor: active ? "#444" : "#bbb",
    borderBottom: active ? "2px solid #f5f5f5" : "1px solid #bbb",
    borderRadius: "4px 4px 0 0",
    background: active ? "#f5f5f5" : "#e4e4e4",
    fontFamily: "monospace",
    fontSize: "13px",
    fontWeight: active ? 700 : 400,
    cursor: "pointer",
    color: active ? "#222" : "#555",
    marginBottom: active ? "-2px" : "-1px",
    position: "relative",
  });

  const dropzoneAccept = {
    "text/plain": [".fastq", ".fq"],
    "application/gzip": [".fastq.gz", ".fq.gz"],
    "application/x-gzip": [".fastq.gz", ".fq.gz"],
    "application/octet-stream": [".fastq", ".fq", ".fastq.gz", ".fq.gz"],
  };

  function handleExportSeeds() {
    if (!seedArrays.length) return;
    const maxPos = Math.max(...seedArrays.map((s) => s.positions.length));
    const header = [
      "seedId",
      "label",
      ...Array.from({ length: maxPos }, (_, i) => `pos${i}`),
    ].join(",");
    const rows = seedArrays.map((s) =>
      [s.id, s.label, ...s.positions].join(","),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seeds-${geneName || "gene"}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleExportSeedsJson() {
    if (!seedArrays.length) return;
    const exportedSeedNumber =
      seedSource?.type === "number" ? seedSource.value : seedSource?.seedNumber ?? null;
    const payload = JSON.stringify({ readLength, seedNumber: exportedSeedNumber, seedArrays }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seeds-${geneName || "gene"}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleLoadSeeds(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        if (!Array.isArray(loaded.seedArrays) || !loaded.seedArrays.length) {
          alert("Seed file contains no seed arrays.");
          return;
        }
        if (readLength && loaded.readLength !== readLength) {
          alert(`Seed file was built for readLength=${loaded.readLength}, current readLength=${readLength}. Seeds not loaded.`);
          return;
        }
        const seedFile = {
          name: file.name,
          readLength: loaded.readLength,
          seedNumber: loaded.seedNumber ?? null,
          seedArrays: loaded.seedArrays,
        };
        setLoadedSeedFile(seedFile);
        // Gene already loaded: rebuild now. Otherwise the file is used at gene lookup (indices built once).
        if (geneSequence && readLength) {
          setSeedSource({ type: "file", name: seedFile.name, seedNumber: seedFile.seedNumber });
          applySeedData(seedFile.seedArrays, geneSequence, geneInfo, transcripts);
        }
      } catch {
        alert("Could not parse seed file.");
      }
    };
    reader.readAsText(file);
  }

  async function handleExportPdf() {
    if (isPdfExporting) return;
    setIsPdfExporting(true);
    try {
      await exportOverviewPdf({
        seqMode,
        geneName,
        geneInfo,
        geneSequence,
        maskedGeneSeq,
        seedArrays,
        matchingReads,
        validatedPairs,
        greyedR1Reads,
        coverageDataUrl: coverageRef.current?.getCanvasDataUrl() ?? null,
        coverageDimensions: coverageRef.current?.getCanvasDimensions() ?? null,
        coverageTranscripts: transcripts,
        txEvidence,
        readLength: readLength || 100,
        fileName: files[0]?.name || "",
      });
    } finally {
      setIsPdfExporting(false);
    }
  }

  async function handleExportWindowPdf(windowParams) {
    await exportZoomWindowPdf(windowParams);
  }

  return (
    <div style={{ ...Styles.container, paddingBottom: "50vh" }}>
      <h2>Sparse Seed‑n‑Vote Gene Finder</h2>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <h3 style={{ margin: 0 }}>
          A tool for finding gene matches in FASTQ files using random sparse
          seed arrays
        </h3>
        <MoreInfoWidget />
      </div>

      {/* Top row — three panels side by side */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          marginTop: "1rem",
          alignItems: "flex-start",
        }}
      >
        {/* Left column: R1 drop zone + mode selector + R2 drop zone */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          <DropZone
            onFilesSelected={handleFilesSelected}
            accept={dropzoneAccept}
            label="Drop R1 (or single-end) .fastq/.gz, or drop both R1+R2 together"
            multiple={true}
            selectedFiles={files}
            fileInfo={
              readLength ? [{ label: "Read Length", value: readLength }] : []
            }
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              fontSize: "12px",
              fontFamily: "monospace",
            }}
          >
            <label>
              Mode:
              <select
                value={seqMode}
                onChange={(e) => setSeqMode(e.target.value)}
                style={{ marginLeft: "0.4rem", fontSize: "12px" }}
                title="DNA: paired ends within ~1000 bp. RNA: same gene, up to 1 Mbp apart."
              >
                <option value="DNA">DNA</option>
                <option value="RNA">RNA</option>
              </select>
            </label>
            <span style={{ color: "#888" }}>
              {seqMode === "RNA"
                ? "insert ≤ 1 Mbp"
                : `insert ${minInsert}–${maxInsert} bp`}
            </span>
          </div>
          <DropZone
            onFilesSelected={handleR2FileSelected}
            accept={dropzoneAccept}
            label="Drop R2 .fastq/.gz here (optional)"
            multiple={false}
            selectedFiles={r2File ? [r2File] : []}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Seeds: chosen before (or after) gene lookup — seed number or a saved seeds JSON */}
          <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", flexWrap: "wrap", marginBottom: "0.4rem", fontSize: "12px" }}>
            <label htmlFor="fgf-seed-number" title="Seed for the random seed-array generator — the same number always gives the same arrays">
              Seed #
            </label>
            <input
              id="fgf-seed-number"
              value={seedNumber}
              onChange={(e) => setSeedNumber(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { setLoadedSeedFile(null); regenerateFromSeedNumber(seedNumber); }
              }}
              disabled={seedControlsDisabled || !!loadedSeedFile}
              maxLength={10}
              style={{ width: "10ch", fontFamily: "monospace" }}
            />
            {geneSequence && readLength && !loadedSeedFile && (
              <button
                onClick={() => regenerateFromSeedNumber(seedNumber)}
                disabled={seedControlsDisabled}
                style={{ fontSize: "11px", padding: "2px 6px", cursor: "pointer" }}
              >
                Apply
              </button>
            )}
            <button
              onClick={handleRandomSeed}
              disabled={seedControlsDisabled}
              style={{ fontSize: "11px", padding: "2px 6px", cursor: "pointer" }}
            >
              Random
            </button>
            <button
              onClick={() => seedLoadInputRef.current?.click()}
              disabled={seedControlsDisabled}
              title="Load a previously saved seeds JSON (before or after gene lookup)"
              style={{ fontSize: "11px", padding: "2px 6px", cursor: "pointer" }}
            >
              Load Seeds JSON
            </button>
            <input
              ref={seedLoadInputRef}
              type="file"
              accept=".json"
              style={{ display: "none" }}
              onChange={handleLoadSeeds}
            />
            {loadedSeedFile && (
              <span style={{ fontFamily: "monospace" }}>
                {loadedSeedFile.name}
                <button
                  onClick={handleClearSeedFile}
                  disabled={seedControlsDisabled}
                  title="Stop using this seed file"
                  style={{ fontSize: "11px", padding: "0 4px", marginLeft: "0.25rem", cursor: "pointer" }}
                >
                  ×
                </button>
              </span>
            )}
          </div>
          <GeneLookupWidget
            geneName={geneName}
            setGeneName={setGeneName}
            onSequenceLoaded={handleGeneSequenceLoaded}
            onLookupError={handleGeneLookupFailed}
            geneSequence={geneSequence}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ProcessControls
            status={status}
            onProcess={handleProcess}
            onPauseResume={handlePauseResume}
            onAbort={handleAbort}
            canProcess={canProcess}
            progress={progress}
            keptCount={keptCount}
            totalReads={totalReadsDisplay}
            elapsedMs={elapsedMs}
            readsPerSec={readsPerSec}
            workerCount={workerCount}
            onWorkerCountChange={setWorkerCount}
            workerStates={workerStates}
            matchThresholdPct={matchThresholdPct}
            onMatchThresholdChange={setMatchThresholdPct}
            r1Stats={r1Stats}
            r2KeptCount={r2KeptCount}
          />
        </div>
      </div>

      {/* Tab bar */}
      <div style={tabBarStyle}>
        {TABS.map((t) => (
          <button
            key={t.key}
            style={tabBtnStyle(activeTab === t.key)}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Seeds */}
      {activeTab === "seeds" && (
        <div style={{ marginTop: "1rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
            {seedArrays.length > 0 && (
              <>
                <button
                  onClick={handleExportSeeds}
                  style={{ fontSize: "11px", padding: "2px 8px", cursor: "pointer" }}
                >
                  Export Seeds CSV
                </button>
                <button
                  onClick={handleExportSeedsJson}
                  style={{ fontSize: "11px", padding: "2px 8px", cursor: "pointer" }}
                >
                  Export Seeds JSON
                </button>
              </>
            )}
            {seedSource && (
              <span style={{ fontSize: "11px", alignSelf: "center", fontFamily: "monospace" }}>
                {seedSource.type === "number"
                  ? `Random seed: ${seedSource.value}`
                  : `Seeds loaded from ${seedSource.name}${seedSource.seedNumber != null ? ` (seed number ${seedSource.seedNumber})` : ""}`}
              </span>
            )}
          </div>
          <SeedVisualization seedArrays={seedArrays} readLength={readLength} />
          <div
            style={{
              display: "flex",
              gap: "1rem",
              marginTop: "1rem",
              alignItems: "flex-start",
            }}
          >
            <PerSeedSummaryPanel seedStats={seedStats} />
            <MostUniquesPanel seedStats={seedStats} />
          </div>
          <TxSeedIndexPanel txIndexStats={txIndexStats} seedArrays={seedArrays} />
        </div>
      )}

      {/* Tab: Matched Reads */}
      {activeTab === "reads" && (
        <div style={{ marginTop: "1rem" }}>
          <ResultsView
            matchingReads={matchingReads}
            seedArrays={seedArrays}
            validatedPairs={validatedPairs}
            greyedR1={greyedR1Reads}
          />
        </div>
      )}

      {/* Tab: QC (reserved) */}
      {activeTab === "qc" && (
        <div
          style={{ marginTop: "2rem", color: "#888", fontFamily: "monospace" }}
        >
          QC — coming soon
        </div>
      )}

      {/* Tab: Pileup */}
      {activeTab === "pileup" && (
        <div style={{ marginTop: "1rem" }}>
          {!processingFinished ||
          (matchingReads.length === 0 &&
            validatedPairs.length === 0 &&
            greyedR1Reads.length === 0) ? (
            <div style={{ color: "#888", fontFamily: "monospace" }}>
              No matches yet — run processing first.
            </div>
          ) : (
            <>
              <CoverageOverview
                ref={coverageRef}
                geneSequence={geneSequence}
                matchingReads={pairedMode ? pileupReads : singlePileupReads}
                readLength={readLength || 100}
                windowStart={pileupWindowStart}
                windowSize={pileupWindowSize}
                onWindowJump={setPileupWindowStart}
                geneInfo={geneInfo}
                onExportPdf={handleExportPdf}
                isPdfExporting={isPdfExporting}
                transcripts={transcripts}
                txEvidence={txEvidence}
              />
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  marginBottom: "0.5rem",
                }}
              >
                <button onClick={jumpPileupToStart}>Gene Start</button>
                <button onClick={() => movePileupWindow(-2)}>
                  {"<<"} Prev {2 * pileupStep} bp
                </button>
                <button onClick={() => movePileupWindow(-1)}>
                  {"<"} Prev {pileupStep} bp
                </button>
                <button onClick={() => movePileupWindow(1)}>
                  Next {pileupStep} bp {">"}
                </button>
                <button onClick={() => movePileupWindow(2)}>
                  Next {2 * pileupStep} bp {">>"}
                </button>
                <button onClick={jumpPileupToEnd}>Gene End</button>
                <button onClick={jumpPileupToFirstMatch}>First Match</button>
                <button onClick={jumpPileupToNextMatch}>Next Match</button>
                <label style={{ marginLeft: "0.5rem" }}>
                  Window:
                  <select
                    value={pileupWindowSize}
                    onChange={(e) => {
                      const nextSize = Number(e.target.value);
                      setPileupWindowSize(nextSize);
                      setPileupWindowStart((current) =>
                        Math.max(
                          0,
                          Math.min(
                            Math.max(0, geneSequence.length - nextSize),
                            current,
                          ),
                        ),
                      );
                    }}
                    style={{ marginLeft: "0.25rem" }}
                  >
                    {pileupWindowSizes.map((size) => (
                      <option key={size} value={size}>
                        {size} bp
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div
                style={{
                  ...Styles.smallMargin,
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  flexWrap: "wrap",
                }}
              >
                <label
                  style={{
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.25rem",
                  }}
                >
                  Pileup %:
                  <select
                    value={pileupThresholdPct}
                    onChange={(e) =>
                      setPileupThresholdPct(Number(e.target.value))
                    }
                    style={{ fontSize: "11px" }}
                  >
                    {[30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
                      <option key={v} value={v}>
                        {v}% (
                        {Math.max(
                          1,
                          Math.ceil(((seedArrays?.length || 1) * v) / 100),
                        )}{" "}
                        seeds)
                      </option>
                    ))}
                  </select>
                </label>
                <span style={{ fontSize: "12px" }}>
                  — showing {pileupReads.length} reads. Window starts at{" "}
                  {pileupWindowStart}.
                </span>
                {pairedMode && (
                  <span
                    style={{
                      fontSize: "12px",
                      color: Styles.pairConnectorColor,
                    }}
                  >
                    {validatedPairs.length} paired, {greyedR1Reads.length}{" "}
                    unconfirmed
                  </span>
                )}
              </div>
              <PileupView
                geneSequence={geneSequence}
                matchingReads={pairedMode ? [] : singlePileupReads}
                readLength={readLength}
                windowStart={pileupWindowStart}
                windowSize={pileupWindowSize}
                geneInfo={geneInfo}
                validatedPairs={pileupValidatedPairs}
                greyedR1={pileupGreyedR1}
                onExportWindowPdf={handleExportWindowPdf}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
