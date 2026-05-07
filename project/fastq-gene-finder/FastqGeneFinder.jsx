import React, { useState, useRef, useCallback } from "react";
import { FASTQ_GENE_FINDER_CONFIG } from "./fastq-gene-finder-config.js";
import FileDropZone from "./widgets/FileDropZone.jsx";
import PileupView from "./widgets/PileupView.jsx";
import ProcessControls from "./widgets/ProcessControls.jsx";
import ResultsView from "./widgets/ResultsView.jsx";
import SeedStatsPanel from "./widgets/SeedsStatsPanel.jsx";
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
function getFastqReadableStream(file) {
  const stream = file.stream();
  if (file.name.toLowerCase().endsWith(".gz")) {
    return stream.pipeThrough(new DecompressionStream("gzip"));
  }
  return stream;
}

async function readFirstFastqSequence(file) {
  const stream = getFastqReadableStream(file);
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let partial = "";
  let lineBuffer = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    partial += decoder.decode(value, { stream: true });

    const lines = partial.split(/\r?\n/);
    partial = lines.pop();

    for (const line of lines) {
      lineBuffer.push(line);

      if (lineBuffer.length === 4) {
        await reader.cancel();
        return lineBuffer[1].trim();
      }
    }
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
}) {
  const totalBytes = file.size;
  let bytesRead = 0;
  const stream = getFastqReadableStream(file);
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let partial = "";
  let lineBuffer = [];
  let readIndex = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      // Abort requested
      if (abortRef && abortRef.current) {
        await reader.cancel();
        return { done: true };
      }

      // Pause support: yield until unpaused or aborted
      if (pauseRef && pauseRef.current) {
        while (pauseRef.current && !(abortRef && abortRef.current)) {
          await tick();
        }
        if (abortRef && abortRef.current) {
          await reader.cancel();
          return { done: true };
        }
      }

      // Update progress
      bytesRead +=
        value && (value.byteLength || value.length)
          ? value.byteLength || value.length
          : 0;
      const isCompressed = file.name.toLowerCase().endsWith(".gz");
      if (onProgress)
        onProgress(bytesRead, isCompressed ? null : totalBytes, file.name);

      // Decode chunk and append to partial buffer
      const text = decoder.decode(value, { stream: true });
      partial += text;

      // Protect against non-string partial
      if (typeof partial !== "string") partial = String(partial || "");

      const lines = partial.split(/\r?\n/);
      partial = lines.pop();

      for (const line of lines) {
        lineBuffer.push(line);

        if (lineBuffer.length === 4) {
          const seq = (lineBuffer[1] || "").trim();
          try {
            onRead(seq, readIndex);
          } catch (err) {
            // swallow handler errors so streaming can continue or be aborted upstream
            console.error("onRead handler threw:", err);
          }
          readIndex++;
          lineBuffer = [];

          // Yield to event loop periodically to keep UI responsive
          if (readIndex % 10 === 0) {
            await tick();
          }
        }
      }
    }

    // Flush any remaining decoded text
    const finalText = decoder.decode();
    if (finalText) {
      partial += finalText;
      const lines = partial.split(/\r?\n/);
      partial = lines.pop();
      for (const line of lines) {
        lineBuffer.push(line);
        if (lineBuffer.length === 4) {
          const seq = (lineBuffer[1] || "").trim();
          try {
            onRead(seq, readIndex);
          } catch (err) {
            console.error("onRead handler threw:", err);
          }
          readIndex++;
          lineBuffer = [];
          if (readIndex % 10 === 0) await tick();
        }
      }
    }

    // If we ended with a complete record in buffer, emit it
    if (lineBuffer.length === 4) {
      const seq = (lineBuffer[1] || "").trim();
      try {
        onRead(seq, readIndex);
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

function reverseComplement(seq) {
  const complement = {
    A: "T",
    T: "A",
    C: "G",
    G: "C",
    U: "A",
    a: "t",
    t: "a",
    c: "g",
    g: "c",
    u: "a",
    N: "N",
    n: "n",
  };
  let out = "";
  for (let i = seq.length - 1; i >= 0; i--) {
    const ch = seq[i];
    out += complement[ch] || "N";
  }
  return out;
}

// Build a gene-side sparse-mer index for each seed array.
// Each index maps the sampled bases (concatenated) -> array of window start positions in the gene
function buildSeedIndices(geneSequence, readLength, seedArrays) {
  const maxStart = Math.max(0, geneSequence.length - readLength);
  return seedArrays.map((seed) => {
    const map = new Map();
    for (let pos = 0; pos <= maxStart; pos++) {
      let ok = true;
      let key = "";
      for (const idx of seed.positions) {
        const ch = geneSequence[pos + idx];
        if (!ch) {
          ok = false;
          break;
        }
        key += ch;
      }
      if (!ok) continue;
      const arrPositions = map.get(key);
      if (arrPositions) arrPositions.push(pos);
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
            sampleKey: key,
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

// Score a read by looking up sparse-mer keys in each seed's index.
function scoreReadUsingIndices(read, seedArrays, seedIndices, minSeedMatches) {
  if (!seedIndices || !seedIndices.length) return [];
  const posScores = new Map();
  const posSeeds = new Map(); //track which seeds matched

  for (let s = 0; s < seedArrays.length; s++) {
    const seed = seedArrays[s];
    const idxs = seed.positions;
    let key = "";
    for (const i of idxs) {
      key += read[i] || "";
    }

    const map = seedIndices[s];
    const hits = map?.get(key);
    if (hits) {
      for (const pos of hits) {
        posScores.set(pos, (posScores.get(pos) || 0) + 1);
        if (!posSeeds.has(pos)) posSeeds.set(pos, []);
        posSeeds.get(pos).push(seed.id);
      }
    }

    const bestPossible = seedArrays.length - s - 1;
    const currentBest = Math.max(...posScores.values(), 0);
    if (currentBest + bestPossible < minSeedMatches) {
      return [];
    }
  }

  const out = [];
  for (const [pos, score] of posScores.entries()) {
    out.push({ pos, score, seedIds: posSeeds.get(pos) });
  }
  return out;
}

/* ============================================================
   MAIN COMPONENT: FastqGeneFinder
============================================================ */
export default function FastqGeneFinderApp() {
  const [files, setFiles] = useState([]);
  const [geneName, setGeneName] = useState("");
  const [geneSequence, setGeneSequence] = useState("");
  const [readLength, setReadLength] = useState(null);
  const [seedArrays, setSeedArrays] = useState([]);
  const [matchingReads, setMatchingReads] = useState([]);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0, fileName: "" });
  const [keptCount, setKeptCount] = useState(0);
  const [discardedCount, setDiscardedCount] = useState(0);
  const [showPileup, setShowPileup] = useState(false);
  const pileupWindowSizes = [100, 125, 150, 175, 200, 225, 250];
  const [pileupWindowSize, setPileupWindowSize] = useState(150);
  const [pileupWindowStart, setPileupWindowStart] = useState(0);
  const [seedStats, setSeedStats] = useState({
    perSeedStats: [],
    topUniqueSamples: [],
  });

  const pauseRef = useRef(false);
  const abortRef = useRef(false);
  const indicesRef = useRef(null);

  const tick = () => new Promise((r) => setTimeout(r, 0));

  const canProcess =
    !!files.length &&
    !!geneSequence &&
    !!readLength &&
    !!seedArrays.length &&
    status !== "processing";

  const pileupStep = 25;
  const pileupMinScore = Math.max(
    1,
    Math.ceil((seedArrays?.length || 1) * 0.7),
  );
  const pileupReads = matchingReads.filter(
    (read) => (read.score ?? 0) >= pileupMinScore,
  );

  const getReadStart = (read) => read.position ?? read.positions?.[0];

  const movePileupWindow = (direction) => {
    const maxStart = Math.max(0, geneSequence.length - pileupWindowSize);
    setPileupWindowStart((current) =>
      Math.max(0, Math.min(maxStart, current + direction * pileupStep)),
    );
  };

  const jumpPileupToStart = () => {
    setPileupWindowStart(0);
  };

  const jumpPileupToEnd = () => {
    setPileupWindowStart(Math.max(0, geneSequence.length - pileupWindowSize));
  };

  const jumpPileupToFirstMatch = () => {
    const starts = pileupReads
      .map(getReadStart)
      .filter((pos) => Number.isFinite(pos));

    if (!starts.length) return;

    const earliest = Math.min(...starts);
    const maxStart = Math.max(0, geneSequence.length - pileupWindowSize);
    setPileupWindowStart(Math.max(0, Math.min(maxStart, earliest)));
  };

  const jumpPileupToNextMatch = () => {
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
    (sequence) => {
      setGeneSequence(sequence);
      setMatchingReads([]);

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
    setSeedArrays([]);
    setMatchingReads([]);
    setStatus(files.length ? "awaiting-gene" : "idle");
  }, [files.length]);

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
        const seq = await readFirstFastqSequence(file);
        setReadLength(seq.length);
        setStatus("awaiting-gene");
      } catch {
        setReadLength(null);
        setStatus("error");
      }
    }, 0);
  }, []);

  /* ---------------- Processing ---------------- */
  const handleProcess = useCallback(async () => {
    if (!files.length || !geneSequence || !seedArrays.length) return;

    const file = files[0];
    setStatus("processing");
    setMatchingReads([]);
    setKeptCount(0);
    setDiscardedCount(0);
    pauseRef.current = false;
    abortRef.current = false;

    // Store file info for display
    const fileName = file.name;

    // Use prebuilt seed indices to avoid scanning the whole gene per read
    const seedIndices = indicesRef.current;

    // For .gz files, we can't know decompressed size upfront, so track decompressed bytes instead
    const isCompressed = file.name.toLowerCase().endsWith(".gz");
    const totalBytes = isCompressed ? null : file.size;

    // Local accumulators for streaming/flushing
    let flushBuffer = [];

    const flush = () => {
      if (!flushBuffer.length) return;
      const toFlush = flushBuffer.splice(0, flushBuffer.length);
      setMatchingReads((prev) => prev.concat(toFlush));
    };

    const flushIfNeeded = () => {
      if (flushBuffer.length >= 10) {
        flush();
      }
    };

    // minimum seed matches required (50% of seed arrays)
    const minSeedMatches = Math.max(
      1,
      Math.ceil((seedArrays?.length || 1) * 0.5),
    );

    const handleRead = (seq, index) => {
      const scoreCandidate = (candidateSeq, orientation) => {
        const all = scoreReadUsingIndices(
          candidateSeq,
          seedArrays,
          seedIndices,
          minSeedMatches,
        );
        return { seq: candidateSeq, orientation, all };
      };

      const candidates = [
        scoreCandidate(seq, "forward"),
        scoreCandidate(reverseComplement(seq), "reverse"),
      ].filter(Boolean);

      let keptThis = false;

      for (const candidate of candidates) {
        for (const m of candidate.all) {
          if (m.score >= minSeedMatches) {
            const obj = {
              read: candidate.seq,
              orientation: candidate.orientation,
              readNumber: index + 1,
              fastqHeaderLine: index * 4 + 1,
              fastqSequenceLine: index * 4 + 2,
              position: m.pos,
              positions: [m.pos],
              score: m.score,
              scores: [m.score],
              index,
              seedIds: m.seedIds || [],
            };
            flushBuffer.push(obj);
            flushIfNeeded();
            keptThis = true;
          }
        }
      }

      if (keptThis) {
        setKeptCount((p) => p + 1);
      } else {
        setDiscardedCount((p) => p + 1);
      }
    };

    await streamFastq({
      file,
      fileName,
      onRead: handleRead,
      pauseRef,
      abortRef,
      onProgress: (done, total, fileName) =>
        setProgress({ done, total, fileName }),
      tick,
    });

    // Final flush and completion
    flush();

    if (abortRef.current) {
      setStatus("aborted");
      return;
    }

    setStatus("done");
  }, [files, geneSequence, seedArrays, readLength]);

  const handlePauseResume = () => {
    if (status === "processing") {
      pauseRef.current = true;
      setStatus("paused");
    } else if (status === "paused") {
      pauseRef.current = false;
      setStatus("processing");
    }
  };

  const handleAbort = () => {
    abortRef.current = true;
  };

  /* ---------------- Render ---------------- */
  return (
    <div style={Styles.container}>
      <h2>Sparse Seed‑n‑Vote Gene Finder</h2>
      <h3>
        A tool for finding gene matches in FASTQ files using random sparse seed
        arrays
      </h3>
      <MoreInfoWidget />
      <div style={Styles.twoColumn}>
        <div style={Styles.leftColumn}>
          <FileDropZone
            onFilesSelected={handleFilesSelected}
            selectedFile={files[0]}
            readLength={readLength}
          />

          <GeneLookupWidget
            geneName={geneName}
            setGeneName={setGeneName}
            onSequenceLoaded={handleGeneSequenceLoaded}
            onLookupError={handleGeneLookupFailed}
            geneSequence={geneSequence}
          />

          <ProcessControls
            status={status}
            onProcess={handleProcess}
            onPauseResume={handlePauseResume}
            onAbort={handleAbort}
            canProcess={canProcess}
            progress={progress}
            keptCount={keptCount}
            discardedCount={discardedCount}
          />
        </div>

        <div style={Styles.rightColumn}>
          <SeedVisualization seedArrays={seedArrays} readLength={readLength} />
          {seedStats?.perSeedStats && (
            <SeedStatsPanel seedStats={seedStats} seedArrays={seedArrays} />
          )}
        </div>
      </div>
      <div style={{ marginTop: "1rem" }}>
        <ResultsView matchingReads={matchingReads} seedArrays={seedArrays} />

        {(status === "done" || status === "aborted") &&
          matchingReads.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <button onClick={() => setShowPileup((s) => !showPileup)}>
                {showPileup ? "Hide Pileup" : "Show Pileup"}
              </button>

              {showPileup && (
                <div style={{ marginTop: "0.5rem" }}>
                  <h3>
                    Pileup for reads with score &gt; {pileupMinScore || 0}
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
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
                    <button onClick={jumpPileupToFirstMatch}>
                      First Match in Gene
                    </button>
                    <button onClick={jumpPileupToNextMatch}>
                      Next Matching Read
                    </button>

                    <label style={{ marginLeft: "0.5rem" }}>
                      Window Size:
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

                  <PileupView
                    geneSequence={geneSequence}
                    matchingReads={pileupReads}
                    readLength={pileupReads[0]?.read?.length}
                    windowStart={pileupWindowStart}
                    windowSize={pileupWindowSize}
                  />

                  <div style={Styles.smallMargin}>
                    Showing all reads with score &gt; {pileupMinScore || 0}.
                    Windows starts at {pileupWindowStart}.
                  </div>
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
