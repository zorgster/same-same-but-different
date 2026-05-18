const COMPLEMENT = {
  A: "T", T: "A", C: "G", G: "C", U: "A",
  a: "t", t: "a", c: "g", g: "c", u: "a",
  N: "N", n: "n",
};

export function reverseComplement(seq) {
  const len = seq.length;
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = COMPLEMENT[seq[len - 1 - i]] || "N";
  }
  return out.join("");
}

export function scoreReadUsingIndices(read, seedArrays, seedIndices, minSeedMatches) {
  if (!seedIndices || !seedIndices.length) return [];
  const posScores = new Map();
  const posSeeds = new Map();
  let currentBest = 0;

  for (let s = 0; s < seedArrays.length; s++) {
    const seed = seedArrays[s];
    const idxs = seed.positions;
    const nIdxs = idxs.length;
    let key = "";
    for (let j = 0; j < nIdxs; j++) {
      key += read[idxs[j]];
    }

    const hits = seedIndices[s].get(key);
    if (hits) {
      const nHits = hits.length;
      for (let h = 0; h < nHits; h++) {
        const pos = hits[h];
        const prev = posScores.get(pos) || 0;
        const next = prev + 1;
        posScores.set(pos, next);
        if (next > currentBest) currentBest = next;

        const seedList = posSeeds.get(pos);
        if (seedList) seedList.push(seed.id);
        else posSeeds.set(pos, [seed.id]);
      }
    }

    // Early exit: even if all remaining seeds match, can't reach threshold
    if (currentBest + (seedArrays.length - s - 1) < minSeedMatches) {
      return [];
    }
  }

  const out = [];
  for (const [pos, score] of posScores.entries()) {
    out.push({ pos, score, seedIds: posSeeds.get(pos) });
  }
  return out;
}
