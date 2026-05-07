export const CODON_TABLE = {
  TTT: "F",
  TTC: "F",
  TTA: "L",
  TTG: "L",
  CTT: "L",
  CTC: "L",
  CTA: "L",
  CTG: "L",
  ATT: "I",
  ATC: "I",
  ATA: "I",
  ATG: "M",
  GTT: "V",
  GTC: "V",
  GTA: "V",
  GTG: "V",
  TCT: "S",
  TCC: "S",
  TCA: "S",
  TCG: "S",
  CCT: "P",
  CCC: "P",
  CCA: "P",
  CCG: "P",
  ACT: "T",
  ACC: "T",
  ACA: "T",
  ACG: "T",
  GCT: "A",
  GCC: "A",
  GCA: "A",
  GCG: "A",
  TAT: "Y",
  TAC: "Y",
  TAA: "*",
  TAG: "*",
  CAT: "H",
  CAC: "H",
  CAA: "Q",
  CAG: "Q",
  AAT: "N",
  AAC: "N",
  AAA: "K",
  AAG: "K",
  GAT: "D",
  GAC: "D",
  GAA: "E",
  GAG: "E",
  TGT: "C",
  TGC: "C",
  TGA: "*",
  TGG: "W",
  CGT: "R",
  CGC: "R",
  CGA: "R",
  CGG: "R",
  AGT: "S",
  AGC: "S",
  AGA: "R",
  AGG: "R",
  GGT: "G",
  GGC: "G",
  GGA: "G",
  GGG: "G",
};

export const AA3 = {
  A: "Ala",
  C: "Cys",
  D: "Asp",
  E: "Glu",
  F: "Phe",
  G: "Gly",
  H: "His",
  I: "Ile",
  K: "Lys",
  L: "Leu",
  M: "Met",
  N: "Asn",
  P: "Pro",
  Q: "Gln",
  R: "Arg",
  S: "Ser",
  T: "Thr",
  V: "Val",
  W: "Trp",
  Y: "Tyr",
  "*": "Stop",
  "?": "???",
};

export const HYDRO = new Set(["A", "V", "I", "L", "M", "F", "Y", "W"]);
export const POLAR = new Set(["S", "T", "N", "Q"]);
export const POS = new Set(["K", "R", "H"]);
export const NEG = new Set(["D", "E"]);
export const SPL = new Set(["C", "G", "P"]);

export const BASE_FG = {
  A: "#4ade80",
  T: "#f87171",
  G: "#facc15",
  C: "#60a5fa",
  N: "#9ca3af",
};

export const RES_ENZYMES = [
  { name: "EcoRI", seq: "GAATTC", color: "#ff6b6b" },
  { name: "BamHI", seq: "GGATCC", color: "#fbbf24" },
  { name: "HindIII", seq: "AAGCTT", color: "#6bcb77" },
  { name: "NotI", seq: "GCGGCCGC", color: "#60a5fa" },
  { name: "XhoI", seq: "CTCGAG", color: "#f472b6" },
  { name: "NcoI", seq: "CCATGG", color: "#fb923c" },
  { name: "NdeI", seq: "CATATG", color: "#c084fc" },
  { name: "XbaI", seq: "TCTAGA", color: "#2dd4bf" },
  { name: "SalI", seq: "GTCGAC", color: "#fde047" },
  { name: "KpnI", seq: "GGTACC", color: "#86efac" },
  { name: "SacI", seq: "GAGCTC", color: "#fca5a5" },
  { name: "SmaI", seq: "CCCGGG", color: "#94a3b8" },
  { name: "EcoRV", seq: "GATATC", color: "#f9a8d4" },
  { name: "ClaI", seq: "ATCGAT", color: "#fef08a" },
  { name: "SpeI", seq: "ACTAGT", color: "#c4b5fd" },
  { name: "PstI", seq: "CTGCAG", color: "#67e8f9" },
  { name: "MluI", seq: "ACGCGT", color: "#a5f3fc" },
  { name: "BsaI", seq: "GGTCTC", color: "#fdba74" },
  { name: "BbsI", seq: "GAAGAC", color: "#6ee7b7" },
  { name: "ApaI", seq: "GGGCCC", color: "#5eead4" },
  { name: "NheI", seq: "GCTAGC", color: "#fcd34d" },
  { name: "BglII", seq: "AGATCT", color: "#93c5fd" },
  { name: "AvrII", seq: "CCTAGG", color: "#ddd6fe" },
];

export const EXAMPLE = `>pUC19 Multiple Cloning Site region
ATGAAAGCAATTTTCGTACTGAAAGGTTTTGTTGGTTTTCTTCAGCCATTCGCCATTCAGGCTGCGCAAC
TGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACGCCAGCTGGCGAAAGGGGGATGTGCTGCAA
GGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGTAAAACGACGGCCAGTGAATTCGA
GCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCATAGCT
GTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCATAAAGTGTAAAG
CCTGGGGTGCCTAATGAGTGAGCTAACTTACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCAGTCGGG
AAACCTGTCGTGCCAGCTGCATTAATGAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGC
TCTTCCGCTTCCTCGCTCACTGACTCGCTGCGCTCGGTCGTTCGGCTGCGGCGAGCGGTATCAGGCTACG
GGTCTAGAGCCAGCCGCAGACCGATAAAACACAGAATTCATGCAATAA`;
