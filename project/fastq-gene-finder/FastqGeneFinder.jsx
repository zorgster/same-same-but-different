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

function makeSeedPositions(
  readLength,
  startFraction,
  endFraction,
  positionsPerArray,
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
    if (Math.random() < needed / remaining) {
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
      .pipeThrough(new DecompressionStream("gzip"));
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
}) {
  const totalBytes = file.size;
  let bytesRead = 0;
  let compressedBytesRead = 0;
  const isCompressed = file.name.toLowerCase().endsWith(".gz");
  const stream = getFastqReadableStream(
    file,
    isCompressed
      ? (n) => {
          compressedBytesRead = n;
        }
      : null,
    isCompressed,
  );
  const reader = stream.getReader();

  let lineCount = 0;
  let seqLine = null; // Uint8Array for current sequence line
  let readIndex = 0;
  let remainder = new Uint8Array(0);
  let lastProgressReport = 0; // throttle setProgress to ~10 calls/s

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      if (abortRef && abortRef.current) {
        await reader.cancel();
        return { done: true };
      }

      if (pauseRef && pauseRef.current) {
        while (pauseRef.current && !(abortRef && abortRef.current)) {
          await tick();
        }
        if (abortRef && abortRef.current) {
          await reader.cancel();
          return { done: true };
        }
      }

      bytesRead += value ? value.byteLength : 0;
      if (onProgress) {
        const now = Date.now();
        if (now - lastProgressReport >= 100) {
          onProgress(
            isCompressed ? compressedBytesRead : bytesRead,
            totalBytes,
            file.name,
          );
          lastProgressReport = now;
        }
      }

      const chunk = remainder.length ? concat(remainder, value) : value;
      let segStart = 0;

      for (let pos = 0; pos < chunk.length; pos++) {
        if (chunk[pos] === 10) {
          // newline byte
          const lineInRecord = lineCount % 4;

          if (lineInRecord === 1) {
            // sequence line — copy bytes (chunk may be replaced next iteration)
            const end = pos > segStart && chunk[pos - 1] === 13 ? pos - 1 : pos;
            seqLine = chunk.slice(segStart, end);
          } else if (lineInRecord === 3 && seqLine) {
            // quality line — emit the read
            const end = pos > segStart && chunk[pos - 1] === 13 ? pos - 1 : pos;
            const qualLine = chunk.slice(segStart, end);
            try {
              onRead(seqLine, qualLine, readIndex);
            } catch (err) {
              console.error("onRead handler threw:", err);
            }
            readIndex++;
            seqLine = null;
            if (readIndex % batchSize === 0) await tick();
          }

          lineCount++;
          segStart = pos + 1;
        }
      }

      remainder = chunk.subarray(segStart);
    }

    // Handle file that doesn't end with a newline (emit final quality line if complete)
    if (remainder.length > 0 && lineCount % 4 === 3 && seqLine) {
      const qualLine =
        remainder[remainder.length - 1] === 13
          ? remainder.slice(0, remainder.length - 1)
          : remainder;
      try {
        onRead(seqLine, qualLine, readIndex);
      } catch (err) {
        console.error("onRead handler threw:", err);
      }
    }

    return { done: true };
  } finally {
    try {
      reader.releaseLock && reader.releaseLock();
    } catch (e) {
      /* ignore */
    }
  }
}

/* ============================================================
   SEED GENERATION + MATCHING
============================================================ */
function generateSeedArrays(
  readLength,
  positionsPerArray = FASTQ_GENE_FINDER_CONFIG.positionsPerSeedArray,
) {
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
      ),
    })),
  );
}

// Build a gene-side sparse-mer index for each seed array.
// Each index maps the sampled bases (concatenated) -> array of window start positions in the gene
// 2-bit encoding: A=0, T=1, C=2, G=3 (N/other=0)
const GENE_BASE_BITS = { A: 0, T: 1, C: 2, G: 3, a: 0, t: 1, c: 2, g: 3 };
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

function extractExonIntervals(maskedSeq) {
  const intervals = [];
  let start = -1;
  for (let i = 0; i <= maskedSeq.length; i++) {
    const c = maskedSeq[i];
    const isExon = c >= "A" && c <= "Z";
    if (start === -1 && isExon) start = i;
    else if (start !== -1 && !isExon) {
      intervals.push({ gStart: start, gEnd: i });
      start = -1;
    }
  }
  return intervals;
}

function buildSplicedIndex(intervals, geneSequence, readLength, seedArrays) {
  let seq = "";
  const exonMap = [];
  for (const { gStart, gEnd } of intervals) {
    exonMap.push({
      txStart: seq.length,
      txEnd: seq.length + (gEnd - gStart),
      gStart,
    });
    seq += geneSequence.slice(gStart, gEnd);
  }
  if (seq.length < readLength) return null;
  return {
    txId: "spliced",
    indices: buildSeedIndices(seq, readLength, seedArrays),
    exonMap,
  };
}

function buildSeedIndices(geneSequence, readLength, seedArrays) {
  const maxStart = Math.max(0, geneSequence.length - readLength);
  return seedArrays.map((seed) => {
    const map = new Map(); // Map<number, number[]>
    for (let pos = 0; pos <= maxStart; pos++) {
      let ok = true;
      let key = 0;
      for (const idx of seed.positions) {
        const ch = geneSequence[pos + idx];
        if (!ch) {
          ok = false;
          break;
        }
        key = key * 4 + (GENE_BASE_BITS[ch] ?? 0);
      }
      if (!ok) continue;
      const hits = map.get(key);
      if (hits) hits.push(pos);
      else map.set(key, [pos]);
    }
    return map;
  });
}

function buildCombinedTxIndex(transcripts, geneSequence, geneInfo, readLength, seedArrays) {
  const minus = geneInfo?.strand === -1;
  const toG = (cs, ce) =>
    minus
      ? [geneInfo.end - ce, geneInfo.end - cs + 1]
      : [cs - geneInfo.start, ce - geneInfo.start + 1];

  const indices = seedArrays.map(() => new Map()); // Map<key, Map<txId, txPos[]>>
  const exonMaps = new Map(); // Map<txId, [{txStart, txEnd, gStart}]>

  for (const t of transcripts) {
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
    exonMaps.set(t.id, exonMap);

    const maxStart = seq.length - readLength;
    for (let pos = 0; pos <= maxStart; pos++) {
      for (let s = 0; s < seedArrays.length; s++) {
        const seed = seedArrays[s];
        let key = 0, ok = true;
        for (const idx of seed.positions) {
          const ch = seq[pos + idx];
          if (!ch) { ok = false; break; }
          key = key * 4 + (GENE_BASE_BITS[ch] ?? 0);
        }
        if (!ok) continue;
        let keyMap = indices[s].get(key);
        if (!keyMap) { keyMap = new Map(); indices[s].set(key, keyMap); }
        const txPositions = keyMap.get(t.id);
        if (txPositions) txPositions.push(pos);
        else keyMap.set(t.id, [pos]);
      }
    }
  }
  return { indices, exonMaps };
}

function computeTxIndexStats(indices, exonMaps, transcripts) {
  const numSeeds = indices.length;
  const statsMap = new Map();
  for (const t of transcripts) {
    const em = exonMaps.get(t.id);
    const splicedLen = em?.length ? em[em.length - 1].txEnd : 0;
    statsMap.set(t.id, {
      txId: t.id,
      biotype: t.biotype,
      isCanonical: t.isCanonical,
      splicedLen,
      perSeed: Array.from({ length: numSeeds }, () => ({ uniqueKeys: 0, totalPositions: 0, txUniqueKeys: 0 })),
    });
  }
  for (let s = 0; s < numSeeds; s++) {
    for (const [, txMap] of indices[s]) {
      const isTxUnique = txMap.size === 1;
      for (const [txId, positions] of txMap) {
        const st = statsMap.get(txId);
        if (st) {
          st.perSeed[s].uniqueKeys++;
          st.perSeed[s].totalPositions += positions.length;
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

// Non-blocking, memory-friendly seed stats collector
function computeSeedStatsAsync(
  seedIndices,
  seedArrays,
  topN = 5,
  chunkSize = 1000,
) {
  return new Promise((resolve) => {
    const perSeedStats = [];
    const top = []; // keep at most topN items, sorted descending by count

    function considerTop(item) {
      if (top.length < topN) {
        top.push(item);
        top.sort((a, b) => b.count - a.count);
        return;
      }
      // top[0] has largest count; replace only if current count is smaller (more unique)
      if (
        item.count < top[0].count ||
        (item.count === top[0].count && item.seedId < top[0].seedId)
      ) {
        top[0] = item;
        top.sort((a, b) => b.count - a.count);
      }
    }

    let seedIdx = 0;

    function processNextSeed() {
      if (seedIdx >= seedIndices.length) {
        // done
        // return per-seed stats and topUniqueSamples sorted ascending by count
        resolve({
          perSeedStats,
          topUniqueSamples: top.slice().sort((a, b) => a.count - b.count),
        });
        return;
      }

      const map = seedIndices[seedIdx];
      const seed = seedArrays[seedIdx];
      const stats = {
        seedId: seed.id,
        seedLabel: seed.label,
        distinctSamples: 0,
        singletonCount: 0,
        totalAlignments: 0,
      };
      perSeedStats.push(stats);

      const iter = map.entries();
      let batch = [];

      function processBatch() {
        let i = 0;
        for (; i < chunkSize; i++) {
          const entry = iter.next();
          if (entry.done) break;
          const [key, positions] = entry.value;
          const count = positions.length;
          stats.distinctSamples++;
          stats.totalAlignments += count;
          if (count === 1) stats.singletonCount++;

          considerTop({
            seedId: seed.id,
            seedLabel: seed.label,
            sampleKey: decodeNumericKey(key, seed.positions.length),
            count,
            positions: positions.slice(0, 20),
          });
        }

        if (i < chunkSize) {
          // finished this seed
          seedIdx++;
          // yield once before starting next seed
          setTimeout(processNextSeed, 0);
        } else {
          // more to do for current seed; yield then continue
          setTimeout(processBatch, 0);
        }
      }

      // start batch processing for this seed
      processBatch();
    }

    // start processing seeds
    processNextSeed();
  });
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
      const r1Start = r1.position ?? r1.positions?.[0] ?? 0;
      const r1End = r1Start + (readLength ?? 100);
      best = candidates.reduce((a, b) => {
        const aPos = a.position ?? a.positions?.[0] ?? 0;
        const bPos = b.position ?? b.positions?.[0] ?? 0;
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
        const r1Pos = r1.position ?? r1.positions?.[0] ?? 0;
        const r2Pos = r2.position ?? r2.positions?.[0] ?? 0;
        const d = Math.abs(r2Pos - r1Pos);
        return (
          d >= minInsert && d <= maxInsert && r1.orientation !== r2.orientation
        );
      });
    }

    if (best) {
      const r1Pos = r1.position ?? r1.positions?.[0] ?? 0;
      const r2Pos = best.position ?? best.positions?.[0] ?? 0;
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

  const getReadStart = (read) => read.position ?? read.positions?.[0];

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
        const seeds = generateSeedArrays(readLength);
        setSeedArrays(seeds);
        indicesRef.current = buildSeedIndices(sequence, readLength, seeds);

        // Build per-transcript combined index (RNA) or merged spliced index (DNA/fallback)
        if (seqMode === "RNA" && newTranscripts?.length && info) {
          const txData = buildCombinedTxIndex(newTranscripts, sequence, info, readLength, seeds);
          txDataRef.current = txData;
          setTxIndexStats(computeTxIndexStats(txData.indices, txData.exonMaps, newTranscripts));
        } else if (maskedSeq) {
          const intervals = extractExonIntervals(maskedSeq);
          const result = buildSplicedIndex(intervals, sequence, readLength, seeds);
          txDataRef.current = result ? [result] : [];
        } else {
          txDataRef.current = [];
        }

        setSeedStats({ perSeedStats: [], topUniqueSamples: [] });
        computeSeedStatsAsync(indicesRef.current, seeds).then(setSeedStats);
        setStatus("ready-to-process");
      } else {
        setSeedArrays([]);
        txDataRef.current = [];
        setStatus("awaiting-read-length");
      }
    },
    [readLength, seqMode],
  );

  const handleGeneLookupFailed = useCallback(() => {
    setGeneSequence("");
    setGeneInfo(null);
    setMaskedGeneSeq(null);
    setSeedArrays([]);
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

  const handleProcess = useCallback(async () => {
    if (!files.length || !geneSequence || !seedArrays.length) return;

    const file = files[0];
    const currentR2File = r2File; // capture for this processing run

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
      batchesDispatchedRef.current++;
      workers[workerIdx].postMessage({
        type: "batch",
        payload: { batchId, reads },
      });
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
            pendingMatchesRef.current.push(...matches);
            // Accumulate per-transcript evidence from spliced matches
            const updates = new Map();
            for (const m of matches) {
              for (const { txId } of (m.txEvidence || [])) {
                updates.set(txId, (updates.get(txId) || 0) + 1);
              }
            }
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
    await streamFastq({
      file,
      fileName: file.name,
      batchSize: BATCH_SIZE,
      onRead: (seqBytes, qualBytes, index) => {
        totalReadsRef.current++;
        currentBatchRef.current.push({ seqBytes, qualBytes, index });
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
    });

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
  ]);

  /* ---------------- R2 pass (triggered after R1 completes with r2File set) ---------------- */
  const runR2Pass = useCallback(async () => {
    if (!r2File || !indicesRef.current || !r1MatchMapRef.current) return;

    const r2Map = r1MatchMapRef.current;
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
      batchesDispatchedRef.current++;
      workers[workerIdx].postMessage({
        type: "batch",
        payload: { batchId, reads },
      });
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
          if (matches.length > 0) r2Accumulated.push(...matches);
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

    await streamFastq({
      file: r2File,
      batchSize: BATCH_SIZE,
      onRead: (seqBytes, qualBytes, index) => {
        if (!r2Map.has(index)) return; // skip reads whose R1 did not match
        currentBatchRef.current.push({ seqBytes, qualBytes, index });
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
    });

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
  };

  const tabBtnStyle = (active) => ({
    padding: "0.4rem 1rem",
    border: "none",
    borderBottom: active ? "3px solid #444" : "3px solid transparent",
    background: active ? "#f0f0f0" : "transparent",
    fontFamily: "monospace",
    fontSize: "13px",
    fontWeight: active ? 700 : 400,
    cursor: "pointer",
    marginBottom: "-2px",
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
          {seedArrays.length > 0 && (
            <button
              onClick={handleExportSeeds}
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                marginBottom: "0.5rem",
                cursor: "pointer",
              }}
            >
              Export Seeds CSV
            </button>
          )}
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
