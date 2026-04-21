const PACKAGE_LABELS = {
  annovar: "ANNOVAR",
  bcftools: "BCFtools",
  freebayes: "FreeBayes",
  gatk: "GATK",
  picard: "Picard",
  samtools: "SAMtools",
  snpeff: "SnpEff",
  snpsift: "SnpSift",
  vep: "VEP",
};

const SUBTOOL_LABELS = {
  bcftools: {
    annotate: "Annotate",
    call: "Call",
    concat: "Concat",
    consensus: "Consensus",
    convert: "Convert",
    count: "Count",
    filter: "Filter",
    index: "Index",
    isec: "Isec",
    merge: "Merge",
    mpileup: "Mpileup",
    norm: "Norm",
    query: "Query",
    reheader: "Reheader",
    sort: "Sort",
    stats: "Stats",
    view: "View",
  },
  gatk: {
    combinevariants: "CombineVariants",
    genotypegvcfs: "GenotypeGVCFs",
    haplotypecaller: "HaplotypeCaller",
    mutect: "Mutect",
    mutect2: "Mutect2",
    selectvariants: "SelectVariants",
  },
  snpeff: {
    snpeff: "SnpEff",
  },
  snpsift: {
    snpsift: "SnpSift",
  },
};

const FAMILY_KEYWORDS = [
  { family: "bcftools", keywords: ["bcftools"] },
  { family: "gatk", keywords: ["gatk", "mutect", "genotypegvcfs", "combinevariants", "haplotypecaller"] },
  { family: "picard", keywords: ["picard"] },
  { family: "samtools", keywords: ["samtools"] },
  { family: "vep", keywords: ["vep", "ensembl"] },
  { family: "annovar", keywords: ["annovar"] },
  { family: "dragen", keywords: ["dragen"] },
  { family: "freebayes", keywords: ["freebayes"] },
  { family: "snpeff", keywords: ["snpeff", "snpsift"] },
];

export const HISTORY_HEADER_PATTERNS = {
  keySuffixes: ["command", "commandline", "commandlineoptions", "version", "cmd"],
  keyPrefixes: ["gatk", "bcftools", "mutect", "freebayes", "picard", "samtools", "vep", "snpeff"],
};

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function toDisplayFallback(raw) {
  return String(raw || "").trim();
}

export function formatPackageLabel(rawPackageName) {
  const normalized = normalizeToken(rawPackageName);
  return PACKAGE_LABELS[normalized] || toDisplayFallback(rawPackageName);
}

export function formatSubtoolLabel(packageName, rawSubtoolName) {
  const pkg = normalizeToken(packageName);
  const sub = normalizeToken(rawSubtoolName);

  if (!sub) return "";

  const packageSubtools = SUBTOOL_LABELS[pkg] || {};
  return packageSubtools[sub] || toDisplayFallback(rawSubtoolName);
}

export function isHistoryLikeHeaderKey(key) {
  const keyLower = String(key || "").toLowerCase();
  const hasSuffix = HISTORY_HEADER_PATTERNS.keySuffixes.some((s) => keyLower.endsWith(s));
  const hasPrefix = HISTORY_HEADER_PATTERNS.keyPrefixes.some((p) => keyLower.startsWith(p));
  return hasSuffix || hasPrefix;
}

export function formatToolLabel(packageName, rawSubtoolName = "") {
  const pkgLabel = formatPackageLabel(packageName);
  const subtoolLabel = formatSubtoolLabel(packageName, rawSubtoolName);

  if (!subtoolLabel) return pkgLabel;
  return `${pkgLabel} ${subtoolLabel}`;
}

export function resolveHistoryFamily(key, rawVal = "") {
  const keyText = String(key || "").toLowerCase();
  const valText = String(rawVal || "").toLowerCase();

  for (const entry of FAMILY_KEYWORDS) {
    if (entry.keywords.some((needle) => keyText.includes(needle) || valText.includes(needle))) {
      return entry.family;
    }
  }

  return "other";
}
