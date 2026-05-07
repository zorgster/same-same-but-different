// IUPAC base → regex character class
const IUPAC = {
  A: "A",
  T: "T",
  G: "G",
  C: "C",
  N: "[ATGC]",
  R: "[AG]",
  Y: "[CT]",
  S: "[GC]",
  W: "[AT]",
  K: "[GT]",
  M: "[AC]",
  B: "[CGT]",
  D: "[AGT]",
  H: "[ACT]",
  V: "[ACG]",
};

// Convert an IUPAC pattern string to a RegExp
const iupacToRegex = (pattern) =>
  new RegExp(
    pattern
      .split("")
      .map((c) => IUPAC[c] ?? c)
      .join(""),
    "g",
  );

// Position-frequency matrix for GT donor 9-mer (positions -3 to +6)
// Source: Shapiro & Senapathy (1987), columns = [-3,-2,-1,+1,+2,+3,+4,+5,+6]
const DONOR_PWM = {
  A: [0.41, 0.72, 0.1, 0.0, 0.0, 0.61, 0.71, 0.13, 0.21],
  C: [0.16, 0.06, 0.05, 0.0, 0.0, 0.02, 0.08, 0.07, 0.15],
  G: [0.08, 0.1, 0.82, 1.0, 0.0, 0.27, 0.13, 0.72, 0.13],
  T: [0.35, 0.12, 0.03, 0.0, 1.0, 0.1, 0.08, 0.08, 0.51],
};

// Score thresholds (lower = more permissive, raise to reduce false positives)
const DONOR_THRESHOLD = 2.5;
const ACCEPTOR_THRESHOLD = 3.5;
const PSEUDO = 0.001; // pseudocount to avoid log(0)
const BG = 0.25; // uniform background frequency

// Splice site feature colours
export const SPLICE_COLORS = {
  donor: "#38bdf8", // sky blue
  acceptor: "#818cf8", // indigo
  branchpoint: "#fb7185", // rose
  u12donor: "#f97316", // amber-orange (rare, very distinctive)
};

// Consensus patterns (IUPAC)
const U12_DONOR_PAT = "ATATCCTY"; // minor spliceosome 5′ SS
const U12_BRANCH_PAT = "TCCTTRAY"; // minor spliceosome BPS
const BRANCH_PAT = "[CT][ACGT][CT]T[AG]A[CT]"; // mammalian major BPS

// Log-odds score for a sequence window against a PWM
const scorePWM = (pwm, seq) => {
  let score = 0;
  for (let i = 0; i < seq.length; i++) {
    const freq = (pwm[seq[i]]?.[i] ?? 0) + PSEUDO;
    score += Math.log2(freq / BG);
  }
  return parseFloat(score.toFixed(2));
};

// Score a candidate GT donor. pos = index of the G in GT.
// Requires 3 upstream (exon) and 6 downstream (intron) bases.
const scoreDonor = (seq, pos) => {
  const start = pos - 3;
  const end = pos + 6;
  if (start < 0 || end > seq.length) return null;
  const window = seq.slice(start, end); // 9-mer
  if (window[3] !== "G" || window[4] !== "T") return null;
  return scorePWM(DONOR_PWM, window);
};

// Score a candidate AG acceptor. pos = index of the A in AG.
// Uses polypyrimidine tract content (10 nt upstream) + fixed AG log-odds.
const scoreAcceptor = (seq, pos) => {
  if (pos < 10 || pos + 1 >= seq.length) return null;
  if (seq[pos] !== "A" || seq[pos + 1] !== "G") return null;
  const ppt = seq.slice(pos - 10, pos);
  const pyFrac = [...ppt].filter((c) => c === "C" || c === "T").length / 10;
  const agScore =
    Math.log2((0.9 + PSEUDO) / BG) + // conserved A
    Math.log2((0.99 + PSEUDO) / BG); // invariant G
  const pptScore = Math.log2((pyFrac + PSEUDO) / 0.5); // expected ~50% background
  return parseFloat((agScore + pptScore).toFixed(2));
};

export function findSpliceSites(seq) {
  const sites = [];

  // ── GT donor sites ────────────────────────────────────────
  let i = seq.indexOf("GT");
  while (i !== -1) {
    const score = scoreDonor(seq, i);
    if (score !== null && score >= DONOR_THRESHOLD) {
      sites.push({
        type: "splice",
        subtype: "donor",
        name: "5′ Donor (GT)",
        start: i,
        end: i + 1,
        color: SPLICE_COLORS.donor,
        seq: seq.slice(Math.max(0, i - 3), i + 7),
        score,
      });
    }
    i = seq.indexOf("GT", i + 1);
  }

  // ── AG acceptor sites ─────────────────────────────────────
  i = seq.indexOf("AG");
  while (i !== -1) {
    const score = scoreAcceptor(seq, i);
    if (score !== null && score >= ACCEPTOR_THRESHOLD) {
      sites.push({
        type: "splice",
        subtype: "acceptor",
        name: "3′ Acceptor (AG)",
        start: i,
        end: i + 1,
        color: SPLICE_COLORS.acceptor,
        seq: seq.slice(Math.max(0, i - 10), i + 2),
        score,
      });
    }
    i = seq.indexOf("AG", i + 1);
  }

  // ── Mammalian branch point ────────────────────────────────
  const bpRe = new RegExp(BRANCH_PAT, "g");
  let m;
  while ((m = bpRe.exec(seq)) !== null) {
    sites.push({
      type: "splice",
      subtype: "branchpoint",
      name: "Branch point",
      start: m.index,
      end: m.index + m[0].length - 1,
      color: SPLICE_COLORS.branchpoint,
      seq: m[0],
      score: null,
    });
    bpRe.lastIndex = m.index + 1;
  }

  // ── U12 minor spliceosome donor ───────────────────────────
  const u12Re = iupacToRegex(U12_DONOR_PAT);
  while ((m = u12Re.exec(seq)) !== null) {
    sites.push({
      type: "splice",
      subtype: "u12donor",
      name: "U12 5′ Donor",
      start: m.index,
      end: m.index + m[0].length - 1,
      color: SPLICE_COLORS.u12donor,
      seq: m[0],
      score: null,
    });
    u12Re.lastIndex = m.index + 1;
  }

  // ── U12 branch point ─────────────────────────────────────
  const u12bRe = iupacToRegex(U12_BRANCH_PAT);
  while ((m = u12bRe.exec(seq)) !== null) {
    sites.push({
      type: "splice",
      subtype: "u12branch",
      name: "U12 Branch point",
      start: m.index,
      end: m.index + m[0].length - 1,
      color: SPLICE_COLORS.u12branch,
      seq: m[0],
      score: null,
    });
    u12bRe.lastIndex = m.index + 1;
  }

  return sites;
}
