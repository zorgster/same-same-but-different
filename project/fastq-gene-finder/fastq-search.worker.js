let seedArrays, seedIndices, minSeedMatches;
let txData = [];
let positionSeedMap;
let isAborted = false;

function txPosToGenePos(txPos, exonMap) {
  for (const seg of exonMap) {
    if (txPos >= seg.txStart && txPos < seg.txEnd)
      return seg.gStart + (txPos - seg.txStart);
  }
  return null;
}

function computeJunctions(txPos, readLen, exonMap) {
  const segs = [];
  for (const seg of exonMap) {
    const oStart = Math.max(txPos, seg.txStart);
    const oEnd   = Math.min(txPos + readLen, seg.txEnd);
    if (oStart < oEnd) {
      segs.push({
        readStart: oStart - txPos,
        readEnd:   oEnd   - txPos,
        gStart:    seg.gStart + (oStart - seg.txStart),
      });
    }
  }
  return segs;
}

// 2-bit numeric key encoding — A=0, T=1, C=2, G=3 (N/other=0)
// Keys are built with: key = key * 4 + BASE_BITS[byte]  (pure arithmetic, no bitwise ops)
// Matches buildSeedIndices encoding in FastqGeneFinder.jsx exactly.
const BASE_BITS = new Uint8Array(256); // default 0 (A)
BASE_BITS[84] = 1; BASE_BITS[116] = 1;  // T/t
BASE_BITS[67] = 2; BASE_BITS[99] = 2;   // C/c
BASE_BITS[71] = 3; BASE_BITS[103] = 3;  // G/g

// RC: complement in 2-bit space (A↔T=0↔1, C↔G=2↔3)
const RC_BASE_BITS = new Uint8Array(256); // default 1 (T, complement of A)
RC_BASE_BITS[65] = 1; RC_BASE_BITS[97] = 1;   // A → T(1)
RC_BASE_BITS[84] = 0; RC_BASE_BITS[116] = 0;  // T → A(0)
RC_BASE_BITS[67] = 3; RC_BASE_BITS[99] = 3;   // C → G(3)
RC_BASE_BITS[71] = 2; RC_BASE_BITS[103] = 2;  // G → C(2)

// Reusable per-read numeric key arrays (Float64Array for safe integers up to 2^53)
let readKeysFwd = null;
let readKeysRev = null;

// Reusable score/seed Maps — clear() between reads, no per-read Map allocation
const fwdScores = new Map();
const fwdSeedsMap = new Map();
const revScores = new Map();
const revSeedsMap = new Map();

// Reusable tx-index Maps for RNA mode (same pattern — hoisted to avoid GC churn)
const txFwdScores  = new Map();
const txFwdBest    = new Map();
const txFwdSeedIds = new Map();
const txRevScores  = new Map();
const txRevBest    = new Map();
const txRevSeedIds = new Map();

// Reusable txEvidence array — cleared per read, sliced only on actual match
const txEvidence = [];

self.onmessage = ({ data: { type, payload } }) => {
  if (type === "init") {
    ({ seedArrays, seedIndices, minSeedMatches } = payload);
    txData = payload.txData ?? [];
    isAborted = false;

    // Build inverted position → [seedId] map (runs once per worker)
    positionSeedMap = new Map();
    for (let s = 0; s < seedArrays.length; s++) {
      for (const pos of seedArrays[s].positions) {
        if (!positionSeedMap.has(pos)) positionSeedMap.set(pos, []);
        positionSeedMap.get(pos).push(s);
      }
    }

    // Allocate reusable numeric key arrays once for this worker's lifetime
    readKeysFwd = new Float64Array(seedArrays.length);
    readKeysRev = new Float64Array(seedArrays.length);

    self.postMessage({ type: "ready" });
    return;
  }

  if (type === "abort") {
    isAborted = true;
    return;
  }

  if (type === "batch") {
    const { batchId, reads } = payload;
    const matches = [];
    const numSeeds = seedArrays.length;

    for (const { seqBytes, index } of reads) {
      if (isAborted) return;

      const readLen = seqBytes.length;

      // Reset numeric key accumulators (Float64Array.fill is SIMD-optimized)
      readKeysFwd.fill(0);
      readKeysRev.fill(0);

      // Single pass: forward key uses seqBytes[i]; RC key uses complement of seqBytes[readLen-1-i]
      // Both index the same positionSeedMap entry at position i, so one map lookup serves both.
      for (let i = 0; i < readLen; i++) {
        const ids = positionSeedMap.get(i);
        if (ids) {
          const fwdBits = BASE_BITS[seqBytes[i]];
          const rcBits  = RC_BASE_BITS[seqBytes[readLen - 1 - i]];
          for (const s of ids) {
            readKeysFwd[s] = readKeysFwd[s] * 4 + fwdBits;
            readKeysRev[s] = readKeysRev[s] * 4 + rcBits;
          }
        }
      }

      // Lookup all forward keys (reuse Map, clear between reads)
      fwdScores.clear(); fwdSeedsMap.clear();
      for (let s = 0; s < numSeeds; s++) {
        const hits = seedIndices[s].get(readKeysFwd[s]);
        if (hits) for (const pos of hits) {
          fwdScores.set(pos, (fwdScores.get(pos) || 0) + 1);
          const sl = fwdSeedsMap.get(pos);
          if (sl) sl.push(seedArrays[s].id); else fwdSeedsMap.set(pos, [seedArrays[s].id]);
        }
      }

      // Lookup all RC keys (reuse Map, clear between reads)
      revScores.clear(); revSeedsMap.clear();
      for (let s = 0; s < numSeeds; s++) {
        const hits = seedIndices[s].get(readKeysRev[s]);
        if (hits) for (const pos of hits) {
          revScores.set(pos, (revScores.get(pos) || 0) + 1);
          const sl = revSeedsMap.get(pos);
          if (sl) sl.push(seedArrays[s].id); else revSeedsMap.set(pos, [seedArrays[s].id]);
        }
      }

      let hasMatch = false;

      // Gene-sequence forward matches — store raw seqBytes; string decode deferred to display
      for (const [pos, score] of fwdScores) {
        if (score >= minSeedMatches) {
          matches.push({
            seqBytes, orientation: 1,
            readNumber: index + 1, fastqHeaderLine: index * 4 + 1, fastqSequenceLine: index * 4 + 2,
            position: pos, score,
            index, seedIds: fwdSeedsMap.get(pos) || [],
          });
          hasMatch = true;
        }
      }

      // Gene-sequence reverse matches — seqBytes are forward; orientation=0 tells decoder to RC
      for (const [pos, score] of revScores) {
        if (score >= minSeedMatches) {
          matches.push({
            seqBytes, orientation: 0,
            readNumber: index + 1, fastqHeaderLine: index * 4 + 1, fastqSequenceLine: index * 4 + 2,
            position: pos, score,
            index, seedIds: revSeedsMap.get(pos) || [],
          });
          hasMatch = true;
        }
      }

      // Spliced fallback — only for reads that had no gene-sequence match.
      // Combined index (RNA mode): txData = { indices: Map[], exonMaps: Map }
      // Legacy array (DNA/fallback):  txData = [{txId, indices, exonMap}]
      if (!hasMatch && txData) {
        if (Array.isArray(txData) && txData.length) {
          // Legacy: first-match-wins loop (merged exon-union, one entry)
          outer: for (const { txId, indices, exonMap } of txData) {
            fwdScores.clear(); fwdSeedsMap.clear();
            for (let s = 0; s < numSeeds; s++) {
              const hits = indices[s].get(readKeysFwd[s]);
              if (hits) for (const pos of hits) {
                fwdScores.set(pos, (fwdScores.get(pos) || 0) + 1);
                const sl = fwdSeedsMap.get(pos);
                if (sl) sl.push(seedArrays[s].id); else fwdSeedsMap.set(pos, [seedArrays[s].id]);
              }
            }
            for (const [txPos, score] of fwdScores) {
              if (score >= minSeedMatches) {
                const gPos = txPosToGenePos(txPos, exonMap);
                if (gPos != null) {
                  matches.push({
                    seqBytes, orientation: 1,
                    readNumber: index + 1, fastqHeaderLine: index * 4 + 1, fastqSequenceLine: index * 4 + 2,
                    position: gPos, score,
                    index, seedIds: fwdSeedsMap.get(txPos) || [], source: txId,
                    junctions: computeJunctions(txPos, readLen, exonMap),
                  });
                  hasMatch = true; break outer;
                }
              }
            }
            revScores.clear(); revSeedsMap.clear();
            for (let s = 0; s < numSeeds; s++) {
              const hits = indices[s].get(readKeysRev[s]);
              if (hits) for (const pos of hits) {
                revScores.set(pos, (revScores.get(pos) || 0) + 1);
                const sl = revSeedsMap.get(pos);
                if (sl) sl.push(seedArrays[s].id); else revSeedsMap.set(pos, [seedArrays[s].id]);
              }
            }
            for (const [txPos, score] of revScores) {
              if (score >= minSeedMatches) {
                const gPos = txPosToGenePos(txPos, exonMap);
                if (gPos != null) {
                  matches.push({
                    seqBytes, orientation: 0,
                    readNumber: index + 1, fastqHeaderLine: index * 4 + 1, fastqSequenceLine: index * 4 + 2,
                    position: gPos, score,
                    index, seedIds: revSeedsMap.get(txPos) || [], source: txId,
                    junctions: computeJunctions(txPos, readLen, exonMap),
                  });
                  hasMatch = true; break outer;
                }
              }
            }
          }
        } else if (txData.indices) {
          // Combined per-transcript index: 13 lookups accumulate scores for all transcripts at once.
          const { indices: txIndices, exonMaps } = txData;

          // Accumulate per-transcript scores (fwd and rev) — reuse module-level Maps
          txFwdScores.clear(); txFwdBest.clear(); txFwdSeedIds.clear();
          txRevScores.clear(); txRevBest.clear(); txRevSeedIds.clear();

          for (let s = 0; s < numSeeds; s++) {
            const fwdHit = txIndices[s].get(readKeysFwd[s]);
            if (fwdHit) {
              for (const [txId, positions] of fwdHit) {
                txFwdScores.set(txId, (txFwdScores.get(txId) || 0) + 1);
                if (!txFwdBest.has(txId)) txFwdBest.set(txId, positions[0]);
                const sl = txFwdSeedIds.get(txId);
                if (sl) sl.push(seedArrays[s].id); else txFwdSeedIds.set(txId, [seedArrays[s].id]);
              }
            }
            const revHit = txIndices[s].get(readKeysRev[s]);
            if (revHit) {
              for (const [txId, positions] of revHit) {
                txRevScores.set(txId, (txRevScores.get(txId) || 0) + 1);
                if (!txRevBest.has(txId)) txRevBest.set(txId, positions[0]);
                const sl = txRevSeedIds.get(txId);
                if (sl) sl.push(seedArrays[s].id); else txRevSeedIds.set(txId, [seedArrays[s].id]);
              }
            }
          }

          // Collect all transcripts above threshold; pick best for match
          txEvidence.length = 0;
          let bestScore = 0, bestTxId = null, bestTxPos = null, bestOrientation = null;

          for (const [txId, score] of txFwdScores) {
            if (score >= minSeedMatches) {
              txEvidence.push({ txId, score });
              if (score > bestScore) {
                bestScore = score; bestTxId = txId;
                bestTxPos = txFwdBest.get(txId); bestOrientation = 1;
              }
            }
          }
          for (const [txId, score] of txRevScores) {
            if (score >= minSeedMatches) {
              if (!txFwdScores.has(txId) || txFwdScores.get(txId) < minSeedMatches)
                txEvidence.push({ txId, score });
              if (score > bestScore) {
                bestScore = score; bestTxId = txId;
                bestTxPos = txRevBest.get(txId); bestOrientation = 0;
              }
            }
          }

          if (bestTxId != null) {
            const exonMap = exonMaps.get(bestTxId);
            const gPos = exonMap ? txPosToGenePos(bestTxPos, exonMap) : null;
            if (gPos != null) {
              matches.push({
                seqBytes, orientation: bestOrientation,
                readNumber: index + 1, fastqHeaderLine: index * 4 + 1, fastqSequenceLine: index * 4 + 2,
                position: gPos, score: bestScore,
                index,
                seedIds: bestOrientation === 1 ? (txFwdSeedIds.get(bestTxId) || []) : (txRevSeedIds.get(bestTxId) || []),
                source: bestTxId,
                junctions: computeJunctions(bestTxPos, readLen, exonMap),
                txEvidence: txEvidence.slice(),
              });
              hasMatch = true;
            }
          }
        }
      }
    }

    self.postMessage({ type: "result", batchId, matches });
  }
};
