/* ============================================================
   COMPACT SEED INDICES (typed arrays)

   Each seed array's index is stored as flat typed arrays instead of
   Map<key, number[]>, which cuts memory several-fold and makes the
   indices cheap to clone into Web Workers.

   Gene index (per seed):
     keys      Float64Array  sorted unique keys
     starts    Uint32Array   keys.length + 1 offsets into positions
     positions Uint32Array   window start positions, ascending within a key
     slots     Int32Array    open-addressing hash table → key index (-1 = empty)
     mask      number        slots.length - 1

   Transcript index (per seed): same keys/starts/slots/mask, but starts
   points into per-(key, transcript) entries, ascending by transcript:
     entTx     Uint16Array   transcript index
     entPos    Uint32Array   first (lowest) transcript position for that key
     entCount  Uint32Array   number of positions for that key in that transcript

   2-bit encoding: A=0, T=1, C=2, G=3 (N/other=0) — must match the worker.
============================================================ */

const BASE_CODE = new Uint8Array(256); // default 0 (A, N, other)
BASE_CODE[84] = 1; BASE_CODE[116] = 1;  // T/t
BASE_CODE[67] = 2; BASE_CODE[99] = 2;   // C/c
BASE_CODE[71] = 3; BASE_CODE[103] = 3;  // G/g

function encodeSequence(seq) {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = BASE_CODE[seq.charCodeAt(i) & 0xff];
  return out;
}

// Keys are integers < 2^53 (up to 26 offsets), so hash the low and high 32-bit halves.
function hashKey(key) {
  const lo = key >>> 0;
  const hi = (key / 4294967296) >>> 0;
  let h = Math.imul(lo ^ Math.imul(hi, 0x27d4eb2d), 0x9e3779b1);
  h ^= h >>> 15;
  return h;
}

function buildHashSlots(keys) {
  let cap = 16;
  while (cap < keys.length * 2) cap <<= 1; // load factor ≤ 0.5
  const mask = cap - 1;
  const slots = new Int32Array(cap).fill(-1);
  for (let k = 0; k < keys.length; k++) {
    let i = hashKey(keys[k]) & mask;
    while (slots[i] !== -1) i = (i + 1) & mask;
    slots[i] = k;
  }
  return { slots, mask };
}

// Returns the key's index into keys/starts, or -1 if absent.
export function findKey(index, key) {
  const slots = index.slots;
  const keys = index.keys;
  const mask = index.mask;
  let i = hashKey(key) & mask;
  for (;;) {
    const k = slots[i];
    if (k === -1) return -1;
    if (keys[k] === key) return k;
    i = (i + 1) & mask;
  }
}

function windowKey(codes, start, offsets) {
  let key = 0;
  for (let j = 0; j < offsets.length; j++) key = key * 4 + codes[start + offsets[j]];
  return key;
}

export function buildGeneIndex(geneSequence, readLength, seedArrays) {
  const codes = encodeSequence(geneSequence);
  const nWin = geneSequence.length >= readLength ? geneSequence.length - readLength + 1 : 0;

  return seedArrays.map((seed) => {
    const winKeys = new Float64Array(nWin);
    for (let p = 0; p < nWin; p++) winKeys[p] = windowKey(codes, p, seed.positions);

    const order = new Uint32Array(nWin);
    for (let p = 0; p < nWin; p++) order[p] = p;
    order.sort((a, b) => winKeys[a] - winKeys[b] || a - b);

    const keysTmp = new Float64Array(nWin);
    const startsTmp = new Uint32Array(nWin + 1);
    const positions = new Uint32Array(nWin);
    let nKeys = 0;
    for (let j = 0; j < nWin; j++) {
      const p = order[j];
      const key = winKeys[p];
      if (nKeys === 0 || key !== keysTmp[nKeys - 1]) {
        keysTmp[nKeys] = key;
        startsTmp[nKeys] = j;
        nKeys++;
      }
      positions[j] = p;
    }
    startsTmp[nKeys] = nWin;

    const keys = keysTmp.slice(0, nKeys);
    const { slots, mask } = buildHashSlots(keys);
    return { keys, starts: startsTmp.slice(0, nKeys + 1), positions, slots, mask };
  });
}

// txList: [{ txIdx, seq }] — spliced transcript sequences, each at least readLength long.
export function buildTxIndex(txList, readLength, seedArrays) {
  const encoded = txList.map(({ txIdx, seq }) => ({
    txIdx,
    codes: encodeSequence(seq),
    nWin: seq.length - readLength + 1,
  }));
  const total = encoded.reduce((sum, t) => sum + Math.max(0, t.nWin), 0);

  return seedArrays.map((seed) => {
    const rowKey = new Float64Array(total);
    const rowTx = new Uint16Array(total);
    const rowPos = new Uint32Array(total);
    let n = 0;
    for (const { txIdx, codes, nWin } of encoded) {
      for (let p = 0; p < nWin; p++) {
        rowKey[n] = windowKey(codes, p, seed.positions);
        rowTx[n] = txIdx;
        rowPos[n] = p;
        n++;
      }
    }

    const order = new Uint32Array(total);
    for (let r = 0; r < total; r++) order[r] = r;
    order.sort((a, b) => rowKey[a] - rowKey[b] || rowTx[a] - rowTx[b] || rowPos[a] - rowPos[b]);

    const keysTmp = new Float64Array(total);
    const startsTmp = new Uint32Array(total + 1);
    const entTx = new Uint16Array(total);
    const entPos = new Uint32Array(total);
    const entCount = new Uint32Array(total);
    let nKeys = 0;
    let nEnt = 0;
    for (let j = 0; j < total; j++) {
      const r = order[j];
      const key = rowKey[r];
      const tx = rowTx[r];
      if (nKeys === 0 || key !== keysTmp[nKeys - 1]) {
        keysTmp[nKeys] = key;
        startsTmp[nKeys] = nEnt;
        nKeys++;
      } else if (tx === entTx[nEnt - 1]) {
        entCount[nEnt - 1]++;
        continue;
      }
      entTx[nEnt] = tx;
      entPos[nEnt] = rowPos[r]; // rows are sorted by position, so this is the first
      entCount[nEnt] = 1;
      nEnt++;
    }
    startsTmp[nKeys] = nEnt;

    const keys = keysTmp.slice(0, nKeys);
    const { slots, mask } = buildHashSlots(keys);
    return {
      keys,
      starts: startsTmp.slice(0, nKeys + 1),
      entTx: entTx.slice(0, nEnt),
      entPos: entPos.slice(0, nEnt),
      entCount: entCount.slice(0, nEnt),
      slots,
      mask,
    };
  });
}
