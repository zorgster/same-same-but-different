import React, { useState, useEffect, useRef, useCallback } from "react";
import { FASTQ_GENE_FINDER_CONFIG } from "./fastq-gene-finder-config.js";
import DropZone from "../widgets/DropZone.jsx";
import PileupView from "./widgets/PileupView.jsx";
import CoverageOverview from "./widgets/CoverageOverview.jsx";
import ProcessControls from "./widgets/ProcessControls.jsx";
import ResultsView from "./widgets/ResultsView.jsx";
import {
  MostUniquesPanel,
  PerSeedSummaryPanel,
} from "./widgets/SeedsStatsPanel.jsx";
import SeedVisualization from "./widgets/SeedVisualization.jsx";
import GeneLookupWidget from "./widgets/GeneLookupWidget.jsx";
import * as Styles from "./styles/fastq-gene-finder-styles.jsx";
import MoreInfoWidget from "./widgets/MoreInfoWidget.jsx";

function makeSeedPositions(
  readLength,
  startFraction,
  endFraction,
  positionsPerArray,
) {
  const start = Math.max(0, Math.floor(readLength * startFraction));
  const end = Math.max(start + 1, Math.ceil(readLength * endFraction));
  const positions = new Set();

  while (positions.size < positionsPerArray && positions.size < readLength) {
    const position = Math.floor(start + Math.random() * (end - start));
    positions.add(Math.max(0, Math.min(readLength - 1, position)));
  }

  return [...positions].sort((a, b) => a - b);
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

function getFastqReadableStream(file, onCompressedBytes) {
  const raw = file.stream();
  if (file.name.toLowerCase().endsWith(".gz")) {
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
    if (start === -1 && isExon)       start = i;
    else if (start !== -1 && !isExon) { intervals.push({ gStart: start, gEnd: i }); start = -1; }
  }
  return intervals;
}

function buildSplicedIndex(intervals, geneSequence, readLength, seedArrays) {
  let seq = "";
  const exonMap = [];
  for (const { gStart, gEnd } of intervals) {
    exonMap.push({ txStart: seq.length, txEnd: seq.length + (gEnd - gStart), gStart });
    seq += geneSequence.slice(gStart, gEnd);
  }
  if (seq.length < readLength) return null;
  return { txId: "spliced", indices: buildSeedIndices(seq, readLength, seedArrays), exonMap };
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
   MAIN COMPONENT: FastqGeneFinder
============================================================ */
export default function FastqGeneFinderApp() {
  const [files, setFiles] = useState([]);
  const [geneName, setGeneName] = useState("");
  const [geneSequence, setGeneSequence] = useState("");
  const [geneInfo, setGeneInfo] = useState(null);
  const [maskedGeneSeq, setMaskedGeneSeq] = useState(null);
  const txDataRef = useRef([]);
  const [readLength, setReadLength] = useState(null);
  const [seedArrays, setSeedArrays] = useState([]);
  const [matchingReads, setMatchingReads] = useState([]);
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

  const [, setTimerTick] = useState(0);
  const [finalElapsedMs, setFinalElapsedMs] = useState(null);

  useEffect(() => {
    return () => {
      workersRef.current.forEach((w) => w.terminate());
      workersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (status !== "processing") return;
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
    status !== "processing";

  /* ---------------- Pileup (only active after processing completes) ---------------- */
  const pileupStep = 25;
  const pileupMinScore = Math.max(
    1,
    Math.ceil((seedArrays?.length || 1) * pileupThresholdPct / 100),
  );
  const pileupReads = processingFinished
    ? matchingReads.filter((read) => (read.score ?? 0) >= pileupMinScore)
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
    (sequence, info, maskedSeq) => {
      setGeneSequence(sequence);
      setGeneInfo(info || null);
      setMaskedGeneSeq(maskedSeq ?? null);
      setMatchingReads([]);
      setActiveTab("seeds");

      if (readLength) {
        const seeds = generateSeedArrays(readLength);
        setSeedArrays(seeds);
        // build indices for the newly created seed arrays
        indicesRef.current = buildSeedIndices(sequence, readLength, seeds);

        setSeedStats({ perSeedStats: [], topUniqueSamples: [] }); // reset stats while computing new ones
        computeSeedStatsAsync(indicesRef.current, seeds).then((stats) => {
          setSeedStats(stats);
        });
        setStatus("ready-to-process");
      } else {
        setSeedArrays([]);
        setStatus("awaiting-read-length");
      }
    },
    [readLength],
  );

  const handleGeneLookupFailed = useCallback(() => {
    setGeneSequence("");
    setGeneInfo(null);
    setMaskedGeneSeq(null);
    setSeedArrays([]);
    setMatchingReads([]);
    txDataRef.current = [];
    setStatus(files.length ? "awaiting-gene" : "idle");
  }, [files.length]);

  // Rebuild spliced (exon-union) index whenever masked sequence, gene, or seeds change
  useEffect(() => {
    if (maskedGeneSeq && geneSequence && seedArrays?.length) {
      const intervals = extractExonIntervals(maskedGeneSeq);
      const result = buildSplicedIndex(intervals, geneSequence, readLength || 100, seedArrays);
      txDataRef.current = result ? [result] : [];
    } else {
      txDataRef.current = [];
    }
  }, [maskedGeneSeq, geneSequence, seedArrays, readLength]);

  /* ---------------- File selection ---------------- */
  const handleFilesSelected = useCallback((selected) => {
    setFiles(selected);
    if (!selected.length) return;

    const file = selected[0];

    setStatus("reading-file");
    const fileName = file.name;
    setMatchingReads([]);
    setProgress({ done: 0, total: 0, fileName: fileName });
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

  /* ---------------- Processing ---------------- */
  const BATCH_SIZE = 50000;

  const handleProcess = useCallback(async () => {
    if (!files.length || !geneSequence || !seedArrays.length) return;

    const file = files[0];
    setStatus("processing");
    setProcessingFinished(false);
    setMatchingReads([]);
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
      Math.ceil((seedArrays?.length || 1) * matchThresholdPct / 100),
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

    // Batch dispatch helpers (defined before wiring handlers so they close over workers)
    // pendingBatchRef holds a queue of pre-packaged batch arrays — shift() on a small
    // queue is O(queue_length), not O(total_reads), unlike splice on a flat read array.
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
      // Package any partial final batch that hasn't reached BATCH_SIZE
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
        setStatus("done");
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

    // Flush accumulated matches to React state at most 2×/s — keeps ResultsView/PileupView
    // re-renders from competing with worker throughput
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
        payload: { seedArrays, seedIndices, minSeedMatches, txData: txDataRef.current },
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
  }, [files, geneSequence, seedArrays, readLength, workerCount]);

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <DropZone
            onFilesSelected={handleFilesSelected}
            accept={{
              "text/plain": [".fastq", ".fq"],
              "application/gzip": [".fastq.gz", ".fq.gz"],
              "application/x-gzip": [".fastq.gz", ".fq.gz"],
              "application/octet-stream": [
                ".fastq",
                ".fq",
                ".fastq.gz",
                ".fq.gz",
              ],
            }}
            label="Drop (single-end or R1 of paired-end) .fastq/.gz or click to select"
            multiple={true}
            selectedFiles={files}
            fileInfo={
              readLength ? [{ label: "Read Length", value: readLength }] : []
            }
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
        </div>
      )}

      {/* Tab: Matched Reads */}
      {activeTab === "reads" && (
        <div style={{ marginTop: "1rem" }}>
          <ResultsView matchingReads={matchingReads} seedArrays={seedArrays} />
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
          {!processingFinished || matchingReads.length === 0 ? (
            <div style={{ color: "#888", fontFamily: "monospace" }}>
              No matches yet — run processing first.
            </div>
          ) : (
            <>
              <CoverageOverview
                geneSequence={geneSequence}
                matchingReads={pileupReads}
                readLength={readLength || 100}
                windowStart={pileupWindowStart}
                windowSize={pileupWindowSize}
                onWindowJump={setPileupWindowStart}
                geneInfo={geneInfo}
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
              <div style={{ ...Styles.smallMargin, display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                <label style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  Pileup %:
                  <select
                    value={pileupThresholdPct}
                    onChange={(e) => setPileupThresholdPct(Number(e.target.value))}
                    style={{ fontSize: "11px" }}
                  >
                    {[30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
                      <option key={v} value={v}>
                        {v}% ({Math.max(1, Math.ceil((seedArrays?.length || 1) * v / 100))} seeds)
                      </option>
                    ))}
                  </select>
                </label>
                <span style={{ fontSize: "12px" }}>
                  — showing {pileupReads.length} reads. Window starts at {pileupWindowStart}.
                </span>
              </div>
              <PileupView
                geneSequence={geneSequence}
                matchingReads={pileupReads}
                readLength={pileupReads[0]?.read?.length}
                windowStart={pileupWindowStart}
                windowSize={pileupWindowSize}
                geneInfo={geneInfo}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
