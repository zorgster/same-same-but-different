const TOOL_FIELD_SIGNATURES = [
  {
    key: "mutect2",
    label: "GATK Mutect2",
    info: ["AS_SB_TABLE", "ECNT", "GERMQ", "MBQ", "MFRL", "MMQ", "MPOS", "NALOD", "NLOD", "PON", "POPAF", "RPA", "RU", "STR", "TLOD"],
    format: ["AD", "AF", "DP", "F1R2", "F2R1", "GT", "SB"],
    filter: ["alt_allele_in_normal", "clustered_events", "contamination", "germline", "homologous_mapping_event", "low_qual", "panel_of_normals", "strand_bias", "weak_evidence"],
    other: ["tumor_sample", "normal_sample", "matched_normal_sample", "sample_name"],
  },
  {
    key: "freebayes",
    label: "freebayes",
    info: ["AB", "ABP", "AC", "AF", "AN", "AO", "CIGAR", "DP", "DPB", "DPRA", "EPP", "EPPR", "LEN", "MQM", "NS", "NUMALT", "ODDS", "PAIRED", "PAIREDR", "QA", "QAO", "QR", "RO", "RPL", "RPP", "RPPR", "RPR", "RUN", "SAF", "SAP", "SAR", "SRF", "SRP", "TYPE"],
    format: ["AO", "DP", "GL", "GQ", "GT", "QA", "QR", "RO"],
    filter: ["lowqual", "strandbias", "repeats", "haplotype", "complex"],
    other: ["tumor_sample"],
  },
  {
    key: "gatk-selectvariants",
    label: "GATK SelectVariants",
    info: [],
    format: [],
    filter: [],
    other: [],
  },
  {
    key: "gatk-combinevariants",
    label: "GATK CombineVariants",
    info: [],
    format: [],
    filter: [],
    other: [],
  },
  {
    key: "dragen-hashtablebuild",
    label: "DRAGEN HashTableBuild",
    info: [],
    format: [],
    filter: [],
    other: [],
  },
  {
    key: "dragen-snv-indel",
    label: "DRAGEN SNV/indel",
    info: ["DP", "DB", "LOD"],
    format: ["GT", "GQ", "AD", "DP", "VF", "NL", "SB", "PS"],
    filter: [
      "PASS",
      "LowDP",
      "LowDepth",
      "LowGQ",
      "LowVariantFreq",
      "SB",
      "R8",
      "MultiAllelicSite",
      "ForcedReport",
      "DRAGENSnpHardQUAL",
      "DRAGENIndelHardQUAL",
      "PloidyConflict",
      "base_quality",
      "lod_fstar",
    ],
    other: [],
  },
  {
    key: "dragen-somatic",
    label: "DRAGEN Somatic",
    info: ["DP", "AF", "DB", "COSMIC", "GermlineStatus"],
    format: ["GT", "DP", "AF", "SQ"],
    filter: ["PASS", "LowDP", "base_quality", "strand_artifact", "filtered_reads", "systematic_noise"],
    other: [],
  },
  {
    key: "dragen-sv",
    label: "DRAGEN SV",
    info: ["SVTYPE", "SVLEN", "END", "CIPOS", "CIEND", "MATEID", "SVCLAIM", "MatchSv"],
    format: ["SR", "PR", "PE"],
    filter: [],
    other: [],
  },
  {
    key: "dragen-cnv",
    label: "DRAGEN CNV",
    info: ["SVTYPE", "SVLEN", "END", "REFLEN", "SVCLAIM", "SEGID", "MOSAIC", "HET", "ModelSource"],
    format: ["CN", "SM", "BC", "GC", "CT", "AC", "PE", "TCN", "MCN", "TCNQ"],
    filter: ["cnvLength", "cnvQual", "cnvBinSupportRatio", "cnvCopyRatio"],
    other: ["CoverageUniformity"],
  },
  {
    key: "dragen-str",
    label: "DRAGEN STR",
    info: ["RU", "REFREP"],
    format: ["LCOV"],
    filter: [],
    other: [],
  },
  {
    key: "bcftools-mpileup",
    label: "BCFtools Mpileup",
    info: ["AD", "ADF", "ADR", "BQBZ", "DP", "DPR", "FS", "I16", "IDV", "IMF", "MQ0F", "MQBZ", "MQSBZ", "NM", "NMBZ", "QS", "RPBZ", "SCBZ", "SCR", "SGB", "VDB", "INDEL"],
    format: ["AD", "ADF", "ADR", "DP", "DP4", "DV", "DPR", "GT", "NMBZ", "PL", "QS", "SCR", "SP"],
    filter: [],
    other: [],
  },
  {
    key: "bcftools-call",
    label: "BCFtools Call",
    info: ["AC", "AC1", "AF1", "AF2", "AN", "MQ", "FQ", "PV4", "G3", "HWE", "DP4"],
    format: ["CGT", "UGT", "GT", "GQ", "GP"],
    filter: ["lowqual", "mnp", "indel", "snp", "other", "pass"],
    other: [],
  },
  {
    key: "vcfanno",
    label: "vcfanno",
    info: [],
    format: [],
    filter: [],
    other: [],
  },
];

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function hasEnabledFlag(blob, flagName) {
  const key = String(flagName || "").toLowerCase();
  if (!key) return false;

  return blob.includes(`${key} true`) || blob.includes(`${key}=true`) || blob.includes(`${key} 1`) || blob.includes(`${key}=1`);
}

function detectActiveToolSignals(historyEntries) {
  const signals = new Set();

  for (const entry of historyEntries || []) {
    const blob = normalizeText(
      [
        entry?.family,
        entry?.tool,
        entry?.key,
        entry?.id,
        entry?.command,
        entry?.commandLine,
        entry?.commandLineOptions,
      ].join(" ")
    );

    const hasDragen = blob.includes("dragen");
    const hasHashTableBuild = blob.includes("hashtablebuild") || hasEnabledFlag(blob, "--build-hash-table");
    const hasSomaticMode = blob.includes("--tumor-bam-input") || blob.includes("--vc-enable-germline-tagging") || blob.includes("--somatic-sys-noise-file");
    const hasSvMode = hasEnabledFlag(blob, "--enable-sv");
    const hasCnvMode = hasEnabledFlag(blob, "--enable-cnv");
    const hasStrMode = hasEnabledFlag(blob, "--repeat-genotype-enable");
    const hasRnaHash = hasEnabledFlag(blob, "--ht-build-rna-hashtable");
    const hasHlaHash = hasEnabledFlag(blob, "--ht-build-hla-hashtable");
    const hasVariantCaller = hasEnabledFlag(blob, "--enable-variant-caller");

    if (blob.includes("mutect2") || blob.includes(" mutect ")) signals.add("mutect2");
    if (hasDragen && hasHashTableBuild) signals.add("dragen-hashtablebuild");
    if (hasDragen && hasVariantCaller && !hasSomaticMode) signals.add("dragen-snv-indel");
    if (hasDragen && hasSomaticMode) signals.add("dragen-somatic");
    if (hasDragen && hasSvMode) signals.add("dragen-sv");
    if (hasDragen && hasCnvMode) signals.add("dragen-cnv");
    if (hasDragen && hasStrMode) signals.add("dragen-str");

    // Hash table build can carry mode intent flags in compact histories.
    if (hasDragen && hasHashTableBuild && hasCnvMode) signals.add("dragen-cnv");
    if (hasDragen && hasHashTableBuild && hasRnaHash) signals.add("dragen-snv-indel");
    if (hasDragen && hasHashTableBuild && hasHlaHash) signals.add("dragen-snv-indel");

    if (hasDragen && !hasVariantCaller && !hasSomaticMode && !hasSvMode && !hasCnvMode && !hasStrMode && !hasHashTableBuild) {
      // Fallback for very sparse DRAGEN histories: still attribute germline hard-filter fields.
      signals.add("dragen-snv-indel");
    }

    if (blob.includes("freebayes")) signals.add("freebayes");
    if (blob.includes("selectvariants")) signals.add("gatk-selectvariants");
    if (blob.includes("combinevariants")) signals.add("gatk-combinevariants");
    if (blob.includes("mpileup")) signals.add("bcftools-mpileup");
    if (blob.includes("bcftools") && /\bcall\b/.test(blob)) signals.add("bcftools-call");
    if (blob.includes("vcfanno")) signals.add("vcfanno");
  }

  return signals;
}

function getMatchingActiveToolLabels(id, scope, activeSignals) {
  const labels = [];

  for (const signature of TOOL_FIELD_SIGNATURES) {
    if (!activeSignals.has(signature.key)) continue;

    const signatureSet = new Set(
      (scope === "INFO"
        ? signature.info
        : scope === "FORMAT"
          ? signature.format
          : scope === "FILTER"
            ? signature.filter
            : signature.other).map((v) => String(v).toUpperCase())
    );

    if (signatureSet.has(id)) labels.push(signature.label);
  }

  return labels;
}

function getFieldIdentifier(field, scope) {
  if (scope === "OTHER") return String(field?.ID || field?.key || "");
  return String(field?.ID || "");
}

function inferFieldProducers(field, scope, activeSignals) {
  const id = getFieldIdentifier(field, scope).toUpperCase();
  const description = String(field?.Description || "");
  if (!id) return [];

  const producers = [];
  const activeMatches = getMatchingActiveToolLabels(id, scope, activeSignals);
  if (activeMatches.length) producers.push(...activeMatches);

  if (scope === "FILTER" && /^Q\d+$/.test(id) && activeSignals.has("dragen-snv-indel")) {
    producers.push("DRAGEN SNV/indel");
  }

  const descLower = description.toLowerCase();
  if (/annotation from\s+|\bvcfanno\b|\bbed\b/i.test(descLower)) {
    producers.push("External annotation");
  }

  if (/^(GNOMAD|EXAC|1000G|1000GENOMES|1KG)[_:-]/i.test(id)) {
    producers.push("Population annotation");
  }

  return Array.from(new Set(producers));
}

function annotateFieldsWithProducers(fields, scope, activeSignals) {
  return (fields || []).map((field) => ({
    ...field,
    producers: inferFieldProducers(field, scope, activeSignals),
  }));
}

function buildGroups(annotatedFields) {
  const groups = new Map();

  for (const field of annotatedFields || []) {
    for (const source of field?.producers || []) {
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source).push(field);
    }
  }

  return Array.from(groups.entries())
    .map(([source, sourceFields]) => ({
      source,
      fields: sourceFields.sort((a, b) => String(a?.ID || "").localeCompare(String(b?.ID || ""))),
    }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

export function inferFieldProducerGroups({ infoFields, formatFields, filterFields, otherFields, historyEntries }) {
  const activeSignals = detectActiveToolSignals(historyEntries);
  const annotatedInfoFields = annotateFieldsWithProducers(infoFields, "INFO", activeSignals);
  const annotatedFormatFields = annotateFieldsWithProducers(formatFields, "FORMAT", activeSignals);
  const annotatedFilterFields = annotateFieldsWithProducers(filterFields, "FILTER", activeSignals);
  const annotatedOtherFields = annotateFieldsWithProducers(otherFields, "OTHER", activeSignals);

  return {
    activeSignals: Array.from(activeSignals),
    infoFields: annotatedInfoFields,
    formatFields: annotatedFormatFields,
    filterFields: annotatedFilterFields,
    otherFields: annotatedOtherFields,
    infoGroups: buildGroups(annotatedInfoFields),
    formatGroups: buildGroups(annotatedFormatFields),
    filterGroups: buildGroups(annotatedFilterFields),
    otherGroups: buildGroups(annotatedOtherFields),
  };
}
