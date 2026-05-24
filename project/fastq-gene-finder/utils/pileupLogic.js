import { DECODE_CHAR, decodeRead } from "./seqUtils.js";

export function normalizeSingleRead(m) {
  const seq = m.seqBytes ?? new Uint8Array(0);
  if (m.junctions?.length) {
    const first = m.junctions[0];
    const last  = m.junctions[m.junctions.length - 1];
    return {
      ...m, seq,
      start: first.gStart,
      end:   last.gStart + (last.readEnd - last.readStart),
      bridgeChar: "=",
    };
  }
  const start = m.position;
  return {
    ...m,
    start,
    end: Number.isFinite(start) ? start + Math.max(1, seq.length) : NaN,
    seq,
  };
}

// Build segments for one end of a pair, offsetting readStart/End into combinedSeq.
// Internal exon gaps use bridgeAfter "=" ; the final segment carries bridgeAfter for the
// inter-read gap (either "~" for the insert, or undefined for the last segment of R2).
export function buildEndSegments(read, seqOffset, finalBridgeAfter) {
  const seq   = read.seqBytes ?? new Uint8Array(0);
  const pos   = read.position ?? 0;
  const segs  = [];
  let offset  = seqOffset;

  if (read.junctions?.length) {
    for (let i = 0; i < read.junctions.length; i++) {
      const j   = read.junctions[i];
      const len = j.readEnd - j.readStart;
      segs.push({
        gStart:     j.gStart,
        readStart:  offset,
        readEnd:    offset + len,
        bridgeAfter: i < read.junctions.length - 1 ? "=" : finalBridgeAfter,
      });
      offset += len;
    }
    const junctionSeq = read.junctions.map(j => seq.subarray(j.readStart, j.readEnd));
    const totalLen = junctionSeq.reduce((s, a) => s + a.length, 0);
    const combined = new Uint8Array(totalLen);
    let off = 0;
    for (const part of junctionSeq) { combined.set(part, off); off += part.length; }
    return { segs, seq: combined, seqEnd: offset };
  }

  segs.push({
    gStart:     pos,
    readStart:  offset,
    readEnd:    offset + seq.length,
    bridgeAfter: finalBridgeAfter,
  });
  return { segs, seq, seqEnd: offset + seq.length };
}

export function normalizePairedEntry({ r1, r2 }) {
  // Always put the genomically earlier read first so the insert gap reads left→right
  const r1Pos = r1.position ?? 0;
  const r2Pos = r2.position ?? 0;
  const [first, second] = r1Pos <= r2Pos ? [r1, r2] : [r2, r1];

  const { segs: firstSegs, seq: firstSeq, seqEnd: firstEnd } =
    buildEndSegments(first, 0, "~");
  const { segs: secondSegs, seq: secondSeq } =
    buildEndSegments(second, firstEnd, undefined);

  const junctions   = [...firstSegs, ...secondSegs];

  // Decode both Uint8Array sequences (oriented) and concatenate as string for paired display
  const firstStr  = decodeRead({ seqBytes: firstSeq,  orientation: first.orientation });
  const secondStr = decodeRead({ seqBytes: secondSeq, orientation: second.orientation });
  const combinedSeq = firstStr + secondStr;

  const lastJunc    = junctions[junctions.length - 1];

  return {
    type:     "pair",
    seq:      combinedSeq,
    start:    junctions[0].gStart,
    end:      lastJunc.gStart + (lastJunc.readEnd - lastJunc.readStart),
    junctions,
  };
}

export function buildRows(entries, safeWindowStart, windowEnd, regionLen) {
  const rows = [];

  for (const m of entries) {
    // seq may be Uint8Array (single read) or string (paired combined)
    const isBytes = m.seq instanceof Uint8Array;

    const charAt = isBytes
      ? (i) => (m.seq[i] != null ? DECODE_CHAR[m.seq[i]] : " ")
      : (i) => m.seq[i] ?? " ";

    const sliceStr = isBytes
      ? (start, end) => {
          const sub = m.seq.subarray(start, end);
          const out = new Array(sub.length);
          for (let k = 0; k < sub.length; k++) out[k] = DECODE_CHAR[sub[k]];
          return out.join("");
        }
      : (start, end) => m.seq.slice(start, end);

    if (m.junctions?.length) {
      const defaultBridge = m.bridgeChar ?? "=";
      const placements = [];

      for (let si = 0; si < m.junctions.length; si++) {
        const seg = m.junctions[si];
        const segGEnd = seg.gStart + (seg.readEnd - seg.readStart);

        const visStart = Math.max(seg.gStart, safeWindowStart);
        const visEnd   = Math.min(segGEnd, windowEnd);
        for (let gi = visStart; gi < visEnd; gi++) {
          const readIdx = seg.readStart + (gi - seg.gStart);
          placements.push([gi - safeWindowStart, charAt(readIdx)]);
        }

        // Bridge to next segment — use per-segment bridgeAfter if set, else entry default
        if (si + 1 < m.junctions.length) {
          const nextSeg   = m.junctions[si + 1];
          const bridge    = seg.bridgeAfter !== undefined ? seg.bridgeAfter : defaultBridge;
          const visBStart = Math.max(segGEnd,        safeWindowStart);
          const visBEnd   = Math.min(nextSeg.gStart, windowEnd);
          for (let gi = visBStart; gi < visBEnd; gi++) {
            placements.push([gi - safeWindowStart, bridge]);
          }
        }
      }

      if (!placements.length) continue;

      let placed = false;
      for (const row of rows) {
        let conflict = false;
        for (const [offset] of placements) {
          if (offset >= 0 && offset < regionLen && row[offset] !== " ") { conflict = true; break; }
        }
        if (!conflict) {
          for (const [offset, ch] of placements) {
            if (offset >= 0 && offset < regionLen) row[offset] = ch;
          }
          placed = true;
          break;
        }
      }
      if (!placed) {
        const newRow = Array(regionLen).fill(" ");
        for (const [offset, ch] of placements) {
          if (offset >= 0 && offset < regionLen) newRow[offset] = ch;
        }
        rows.push(newRow);
      }

    } else {
      const offset = Math.max(0, m.start - safeWindowStart);
      const clipStart = Math.max(0, safeWindowStart - m.start);
      const clipEnd = Math.min(m.seq.length, windowEnd - m.start);
      const clippedSeq = sliceStr(clipStart, clipEnd);

      if (!clippedSeq.length) continue;

      let placed = false;
      for (const row of rows) {
        let conflict = false;
        for (let i = 0; i < clippedSeq.length && offset + i < regionLen; i++) {
          if (row[offset + i] !== " ") { conflict = true; break; }
        }
        if (!conflict) {
          for (let i = 0; i < clippedSeq.length && offset + i < regionLen; i++) {
            row[offset + i] = clippedSeq[i];
          }
          placed = true;
          break;
        }
      }
      if (!placed) {
        const newRow = Array(regionLen).fill(" ");
        for (let i = 0; i < clippedSeq.length && offset + i < regionLen; i++) {
          newRow[offset + i] = clippedSeq[i];
        }
        rows.push(newRow);
      }
    }
  }

  return rows;
}
