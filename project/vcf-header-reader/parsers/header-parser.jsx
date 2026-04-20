import { extractHistoryFromOtherEntries } from "./history-parser.jsx";
import { isHistoryLikeHeaderKey } from "./history-tool-labels.jsx";

function parseStructuredField(str) {
  let value = String(str || "").trim();
  if (value.startsWith("<")) value = value.slice(1);
  if (value.endsWith(">")) value = value.slice(0, -1);

  const out = {};
  let i = 0;
  while (i < value.length) {
    const eq = value.indexOf("=", i);
    if (eq === -1) break;
    const key = value.slice(i, eq).trim();
    i = eq + 1;

    let parsed;
    if (value[i] === '"') {
      i += 1;
      const start = i;
      while (i < value.length && value[i] !== '"') {
        if (value[i] === "\\") i += 1;
        i += 1;
      }
      parsed = value.slice(start, i);
      i += 1;
      if (value[i] === ",") i += 1;
    } else {
      const comma = value.indexOf(",", i);
      if (comma === -1) {
        parsed = value.slice(i).trim();
        i = value.length;
      } else {
        parsed = value.slice(i, comma).trim();
        i = comma + 1;
      }
    }

    out[key] = parsed;
  }

  return out;
}

function parseVepCsqColumns(description) {
  const text = String(description || "");
  const match = text.match(/format\s*:\s*(.+)$/i);
  if (!match) return [];
  return match[1].split("|").map((part) => part.trim()).filter(Boolean);
}

function detectAnnotationSource(id, description) {
  const idUpper = String(id || "").toUpperCase();
  const text = String(description || "").toLowerCase();

  if (idUpper === "CSQ" || /\bvep\b|ensembl/i.test(text)) return "VEP";
  if (idUpper === "EFF" || idUpper === "ANN" || /\bsnpeff\b/i.test(text)) return "SnpEff";
  if (idUpper === "BCSQ" || /bcftools\/csq|consequence annotation from bcftools\/csq/i.test(text)) return "BCFtools/csq";
  if (/\bannovar\b/i.test(text)) return "ANNOVAR";
  return null;
}

function parseAnnotationFormatColumns(description) {
  const text = String(description || "");
  const match = text.match(/format\s*:\s*(.+)$/i);
  if (!match) return [];

  let raw = String(match[1] || "").replace(/\\"/g, '"').trim();
  raw = raw.replace(/^[\s"']+|[\s"']+$/g, "");

  const normalize = (part) => String(part || "")
    .replace(/[\[\]()'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let columns = [];
  const open = raw.indexOf("(");
  const close = raw.lastIndexOf(")");
  if (open !== -1 && close !== -1 && close > open) {
    const lead = normalize(raw.slice(0, open));
    const inner = raw.slice(open + 1, close);
    const innerCols = inner.split("|").map(normalize).filter(Boolean);
    columns = [...(lead ? [lead] : []), ...innerCols];
  } else {
    columns = raw.split("|").map(normalize).filter(Boolean);
  }

  return Array.from(new Set(columns));
}

function parsePipeDelimitedColumnsFromDescription(description) {
  const columns = parseAnnotationFormatColumns(description);
  if (columns.length < 3) return [];
  return columns;
}

function hasHistorySignal(historyEntries, pattern) {
  for (const entry of historyEntries || []) {
    const blob = String(
      [entry?.family, entry?.tool, entry?.key, entry?.command, entry?.commandLine, entry?.commandLineOptions].join(" ")
    ).toLowerCase();
    if (pattern.test(blob)) return true;
  }
  return false;
}

function inferInfoSourceFromHistory(infoField, historyEntries) {
  const idUpper = String(infoField?.ID || "").toUpperCase();
  const description = String(infoField?.Description || "");

  const hasVep = hasHistorySignal(historyEntries, /\bvep\b/);
  const hasSnpEff = hasHistorySignal(historyEntries, /\bsnpeff\b|\bsnpsift\b/);
  const hasBcftoolsCsq = hasHistorySignal(historyEntries, /\bbcftools\b.*\bcsq\b|\bcsq\b.*\bbcftools\b/);
  const hasAnnovar = hasHistorySignal(historyEntries, /\bannovar\b/);

  if (idUpper === "CSQ" && hasVep) return "VEP";
  if ((idUpper === "ANN" || idUpper === "EFF") && hasSnpEff) return "SnpEff";
  if (idUpper === "BCSQ" && hasBcftoolsCsq) return "BCFtools/csq";
  if (hasAnnovar && /\bannovar\b/i.test(description)) return "ANNOVAR";

  return null;
}

function parseInfoAnnotationColumnsWithHistory(infoField, scope = "INFO", historyEntries = []) {
  const id = String(infoField?.ID || "").trim();
  const description = String(infoField?.Description || "");
  if (!id || !description) return null;

  const historySource = inferInfoSourceFromHistory(infoField, historyEntries);
  const knownSource = historySource || detectAnnotationSource(id, description);
  let columns = parseAnnotationFormatColumns(description);

  if (!columns.length) {
    columns = parsePipeDelimitedColumnsFromDescription(description);
  }

  if (!knownSource && !columns.length) return null;

  return {
    id,
    source: knownSource || "Generic annotation",
    scope,
    columns,
  };
}

function parseBcftoolsCsqFormatAnnotation(formatField) {
  const id = String(formatField?.ID || "").trim();
  const description = String(formatField?.Description || "");
  if (!id || !description) return null;

  const descLower = description.toLowerCase();
  if (!/bcftools\/csq|bitmask of indexes to info\//i.test(descLower)) return null;

  const match = description.match(/INFO\/([A-Za-z0-9_.-]+)/i);
  const infoTag = match ? match[1] : "BCSQ";

  return {
    id,
    source: "BCFtools/csq",
    scope: "FORMAT",
    columns: [],
    linksToInfoTag: infoTag,
  };
}

function parseFormatAnnotationColumns(formatField) {
  const id = String(formatField?.ID || "").trim();
  const description = String(formatField?.Description || "");
  if (!id || !description) return null;

  const knownSource = detectAnnotationSource(id, description);
  const columns = parsePipeDelimitedColumnsFromDescription(description);
  if (!knownSource && !columns.length) return null;

  return {
    id,
    source: knownSource || "Generic annotation",
    scope: "FORMAT",
    columns,
  };
}

function inferBcftoolsCsqCustomTagFromHistory(historyEntries) {
  for (const entry of historyEntries || []) {
    const text = String(entry?.commandLine || entry?.command || "");
    if (!text || !/\bcsq\b/i.test(text) || !/\bbcftools\b/i.test(text)) continue;

    const match = text.match(/(?:^|\s)(?:-c|--custom-tag)(?:\s+|=)([^\s]+)/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export default function parseHeaderText({ headerText }) {
  const lines = headerText.split("\n");
  const out = {
    fileformat: null,
    fileDate: null,
    reference: null,
    assembly: null,
    source: null,
    phasing: null,
    info: [],
    format: [],
    filter: [],
    contig: [],
    columns: [],
    altEntries: [],
    samples: [],
    csqFields: [],
    annotationColumns: [],
    other: [],
    history: [],
  };

  // Phase 1: strict structural parsing into buckets with no history inference.
  for (const line of lines) {
    if (!line || !line.startsWith("#")) continue;
    const lineLower = line.toLowerCase();
    if (lineLower.startsWith("##fileformat=")) out.fileformat = line.slice(13).trim();
    else if (lineLower.startsWith("##filedate=")) out.fileDate = line.slice(11).trim();
    else if (lineLower.startsWith("##reference=")) out.reference = line.slice(12).trim();
    else if (lineLower.startsWith("##assembly=")) out.assembly = line.slice(11).trim();
    else if (lineLower.startsWith("##source=")) out.source = line.slice(9).trim();
    else if (lineLower.startsWith("##phasing=")) out.phasing = line.slice(10).trim();
    else if (lineLower.startsWith("##info=")) {
      const infoField = parseStructuredField(line.slice(7));
      out.info.push(infoField);
    }
    else if (lineLower.startsWith("##format=")) out.format.push(parseStructuredField(line.slice(9)));
    else if (lineLower.startsWith("##filter=")) out.filter.push(parseStructuredField(line.slice(9)));
    else if (lineLower.startsWith("##contig=")) out.contig.push(parseStructuredField(line.slice(9)));
    else if (lineLower.startsWith("##alt=")) out.altEntries.push(parseStructuredField(line.slice(6)));
    else if (lineLower.startsWith("##")) {
      const rest = line.slice(2);
      const eqIdx = rest.indexOf("=");
      if (eqIdx === -1) {
        out.other.push({ key: rest.trim(), value: "", raw: rest });
      } else {
        const key = rest.slice(0, eqIdx).trim();
        const value = rest.slice(eqIdx + 1);
        out.other.push({ key, value, raw: rest });
      }
    }
    else if (lineLower.startsWith("#chrom")) {
      const cols = line.split("\t");
      out.columns = cols.slice(0, 9).map((column, index) => (index === 0 ? column.replace(/^#/, "") : column)).filter(Boolean);
      out.samples = cols.slice(9).filter(Boolean);
    }
  }

  // Phase 2: parse history from "other" only; do not rescan INFO/FORMAT/contig buckets.
  const historyCandidateEntries = out.other.filter((entry) => isHistoryLikeHeaderKey(entry?.key));
  out.history = extractHistoryFromOtherEntries(historyCandidateEntries);

  // Keep only non-history lines in "other" for UI display.
  out.other = out.other.filter((entry) => !isHistoryLikeHeaderKey(entry?.key));

  // Phase 3: annotate INFO/FORMAT fields using history context.
  for (const infoField of out.info) {
    const infoAnnotation = parseInfoAnnotationColumnsWithHistory(infoField, "INFO", out.history);
    if (infoAnnotation) {
      const hasDuplicate = out.annotationColumns.some(
        (entry) => entry.scope === "INFO" && String(entry.id).toUpperCase() === String(infoAnnotation.id).toUpperCase()
      );
      if (!hasDuplicate) out.annotationColumns.push(infoAnnotation);
    }

    if (String(infoField?.ID || "").toUpperCase() === "CSQ") {
      out.csqFields = parseVepCsqColumns(infoField?.Description);
    }
  }

  for (const fmt of out.format) {
    const fmtCsqAnnotation = parseBcftoolsCsqFormatAnnotation(fmt);
    if (fmtCsqAnnotation) out.annotationColumns.push(fmtCsqAnnotation);

    const fmtGenericAnnotation = parseFormatAnnotationColumns(fmt);
    if (fmtGenericAnnotation) {
      const hasDuplicate = out.annotationColumns.some(
        (entry) => entry.scope === "FORMAT" && String(entry.id).toUpperCase() === String(fmtGenericAnnotation.id).toUpperCase()
      );
      if (!hasDuplicate) out.annotationColumns.push(fmtGenericAnnotation);
    }
  }

  const inferredCsqTag = inferBcftoolsCsqCustomTagFromHistory(out.history);
  if (inferredCsqTag) {
    const hasInfoTag = out.annotationColumns.some(
      (entry) => entry.source === "BCFtools/csq" && entry.scope === "INFO" && String(entry.id).toUpperCase() === String(inferredCsqTag).toUpperCase()
    );

    if (!hasInfoTag) {
      out.annotationColumns.push({
        id: inferredCsqTag,
        source: "BCFtools/csq",
        scope: "INFO",
        columns: [],
        inferredFromHistory: true,
      });
    }
  }

  return out;

}