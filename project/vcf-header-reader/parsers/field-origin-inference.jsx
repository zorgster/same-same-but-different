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
    key: "bcftools",
    label: "BCFtools",
    info: [],
    format: [],
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

    if (blob.includes("mutect2") || blob.includes(" mutect ")) signals.add("mutect2");
    if (blob.includes("freebayes")) signals.add("freebayes");
    if (blob.includes("selectvariants")) signals.add("gatk-selectvariants");
    if (blob.includes("combinevariants")) signals.add("gatk-combinevariants");
    if (blob.includes("bcftools")) signals.add("bcftools");
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
