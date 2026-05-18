let seedArrays, seedIndices, minSeedMatches;
let positionSeedMap, RC_BYTES;
let isAborted = false;

// BYTE_TO_CHAR still needed for building the display seqStr on match
const BYTE_TO_CHAR = new Array(256);
for (let i = 0; i < 256; i++) BYTE_TO_CHAR[i] = String.fromCharCode(i);

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

self.onmessage = ({ data: { type, payload } }) => {
  if (type === "init") {
    ({ seedArrays, seedIndices, minSeedMatches } = payload);
    isAborted = false;

    // Build inverted position → [seedId] map (runs once per worker)
    positionSeedMap = new Map();
    for (let s = 0; s < seedArrays.length; s++) {
      for (const pos of seedArrays[s].positions) {
        if (!positionSeedMap.has(pos)) positionSeedMap.set(pos, []);
        positionSeedMap.get(pos).push(s);
      }
    }

    // RC byte complement lookup (A↔T, C↔G, N→N; everything else → N)
    RC_BYTES = new Uint8Array(256).fill(78);
    RC_BYTES[65] = 84; RC_BYTES[84] = 65;
    RC_BYTES[67] = 71; RC_BYTES[71] = 67;
    RC_BYTES[97] = 116; RC_BYTES[116] = 97;
    RC_BYTES[99] = 103; RC_BYTES[103] = 99;

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

    for (const { seqBytes, qualBytes, index } of reads) {
      if (isAborted) return;

      const readLen = seqBytes.length;

      // Reset numeric key accumulators (Float64Array.fill is SIMD-optimized)
      readKeysFwd.fill(0);
      readKeysRev.fill(0);

      // Forward pass: accumulate 2-bit numeric key for each seed (key = key*4 + base_bits)
      for (let i = 0; i < readLen; i++) {
        const bits = BASE_BITS[seqBytes[i]];
        const fwdIds = positionSeedMap.get(i);
        if (fwdIds) for (const s of fwdIds) readKeysFwd[s] = readKeysFwd[s] * 4 + bits;
      }

      // Reverse pass: accumulate RC numeric key (complement bits, ascending RC-position order)
      for (let i = readLen - 1; i >= 0; i--) {
        const rcBits = RC_BASE_BITS[seqBytes[i]];
        const rcIds = positionSeedMap.get(readLen - 1 - i);
        if (rcIds) for (const s of rcIds) readKeysRev[s] = readKeysRev[s] * 4 + rcBits;
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

      // Convert seq to string only when there are matches to report
      for (const [pos, score] of fwdScores) {
        if (score >= minSeedMatches) {
          matches.push({
            read: String.fromCharCode(...seqBytes),
            orientation: "forward",
            readNumber: index + 1,
            fastqHeaderLine: index * 4 + 1,
            fastqSequenceLine: index * 4 + 2,
            position: pos,
            positions: [pos],
            score,
            scores: [score],
            index,
            seedIds: fwdSeedsMap.get(pos) || [],
          });
        }
      }

      if (revScores.size > 0) {
        // Build RC string only when there are reverse matches to report
        const rcArr = new Array(readLen);
        for (let i = 0; i < readLen; i++) rcArr[i] = String.fromCharCode(RC_BYTES[seqBytes[readLen - 1 - i]]);
        const rcStr = rcArr.join("");

        for (const [pos, score] of revScores) {
          if (score >= minSeedMatches) {
            matches.push({
              read: rcStr,
              orientation: "reverse",
              readNumber: index + 1,
              fastqHeaderLine: index * 4 + 1,
              fastqSequenceLine: index * 4 + 2,
              position: pos,
              positions: [pos],
              score,
              scores: [score],
              index,
              seedIds: revSeedsMap.get(pos) || [],
            });
          }
        }
      }
    }

    self.postMessage({ type: "result", batchId, matches });
  }
};
