import { REFERENCE_SIGNATURES } from "../reference_config.jsx";

export function formatVcfFileDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const normalizedNatural = raw.replace(/\bat\b/i, " ").replace(/\s+/g, " ").trim();
  const parsedNatural = Date.parse(normalizedNatural);
  if (!Number.isNaN(parsedNatural)) {
    const date = new Date(parsedNatural);
    const includesTime = /\d{1,2}:\d{2}/.test(normalizedNatural);
    const isUtc = /\bUTC\b|\bGMT\b|Z$/i.test(normalizedNatural);

    if (includesTime) {
      const options = {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      };
      if (isUtc) {
        options.timeZone = "UTC";
        options.timeZoneName = "short";
      }
      return date.toLocaleString(undefined, options);
    }

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }

  const compactMatch = raw.match(/^(\d{4})(\d{2})(\d{2})(?:[T_ -]?(\d{2})(\d{2})(\d{2})?)?$/);
  if (!compactMatch) return raw;

  const year = Number.parseInt(compactMatch[1], 10);
  const month = Number.parseInt(compactMatch[2], 10) - 1;
  const day = Number.parseInt(compactMatch[3], 10);
  const hour = Number.parseInt(compactMatch[4] || "0", 10);
  const minute = Number.parseInt(compactMatch[5] || "0", 10);
  const second = Number.parseInt(compactMatch[6] || "0", 10);

  const date = new Date(year, month, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) return raw;

  const hasTime = Boolean(compactMatch[4] && compactMatch[5]);
  if (hasTime) {
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function normalizeContigId(rawId) {
  let id = String(rawId || "").trim();
  if (!id) return "";

  id = id.replace(/^chr/i, "");
  const upper = id.toUpperCase();

  if (upper === "M" || upper === "MT") return "MT";
  if (upper === "X" || upper === "Y") return upper;
  if (/^\d+$/.test(upper)) return String(Number.parseInt(upper, 10));

  return upper;
}

export function inferReferenceFromContigs(contigs) {
  if (!Array.isArray(contigs) || contigs.length === 0) return null;

  const lengthsById = {};
  for (const contig of contigs) {
    const id = normalizeContigId(contig.ID);
    const length = Number.parseInt(contig.length, 10);
    if (!id || !Number.isFinite(length)) continue;
    lengthsById[id] = length;
  }

  const candidates = [];
  for (const signature of REFERENCE_SIGNATURES) {
    let compared = 0;
    let matched = 0;
    const matchedContigs = [];

    for (const [id, expectedLength] of Object.entries(signature.contigs)) {
      if (!(id in lengthsById)) continue;
      compared += 1;
      if (lengthsById[id] === expectedLength) {
        matched += 1;
        matchedContigs.push(id);
      }
    }

    if (compared < 2) continue;
    candidates.push({
      ...signature,
      compared,
      matched,
      matchedContigs,
      score: matched / compared,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score || b.matched - a.matched);
  const best = candidates[0];
  const second = candidates[1];

  if (second && Math.abs(best.score - second.score) < 0.01 && best.score < 1) {
    return null;
  }

  let confidence = null;
  if (best.score === 1 && best.compared >= 4) confidence = "high";
  else if (best.score >= 0.8 && best.compared >= 3) confidence = "medium";
  else if (best.score >= 0.6 && best.compared >= 2) confidence = "low";
  else return null;

  return {
    build: best.name,
    aliases: best.aliases,
    confidence,
    matched: best.matched,
    compared: best.compared,
    matchedContigs: best.matchedContigs,
  };
}

export function inferContigNamingConvention(contigs) {
  if (!Array.isArray(contigs) || contigs.length === 0) return null;

  let prefixedWithChr = 0;
  let bare = 0;
  let mtAsM = 0;
  let mtAsMT = 0;
  let observed = 0;

  for (const contig of contigs) {
    const rawId = String(contig?.ID || "").trim();
    if (!rawId) continue;

    observed += 1;
    const lower = rawId.toLowerCase();
    const hasChrPrefix = lower.startsWith("chr");
    if (hasChrPrefix) prefixedWithChr += 1;
    else bare += 1;

    const core = hasChrPrefix ? rawId.slice(3) : rawId;
    const coreUpper = core.toUpperCase();
    if (coreUpper === "M") mtAsM += 1;
    if (coreUpper === "MT") mtAsMT += 1;
  }

  if (observed === 0) return null;

  const baseStyle = prefixedWithChr > bare ? "chr" : bare > prefixedWithChr ? "bare" : "mixed";
  const mtStyle = mtAsM > 0 && mtAsMT === 0 ? "M" : mtAsMT > 0 && mtAsM === 0 ? "MT" : "mixed";

  let label;
  if (baseStyle === "chr") {
    if (mtStyle === "M") label = "chr1..chr22, chrX, chrM";
    else if (mtStyle === "MT") label = "chr1..chr22, chrX, chrMT";
    else label = "chr-prefixed (mixed MT naming)";
  } else if (baseStyle === "bare") {
    if (mtStyle === "MT") label = "1..22, X, MT";
    else if (mtStyle === "M") label = "1..22, X, M";
    else label = "bare contigs (mixed MT naming)";
  } else {
    label = "mixed (chr-prefixed + bare IDs)";
  }

  return {
    label,
    observed,
    prefixedWithChr,
    bare,
  };
}

const CORE_INFO_KEYS = new Set([
  "AC",
  "AF",
  "AN",
  "DP",
  "END",
  "NS",
  "MQ",
  "MQ0",
  "SB",
  "SOMATIC",
  "DB",
  "H2",
  "H3",
  "AA",
  "VALIDATED",
  "1000G",
]);

const CORE_FORMAT_KEYS = new Set([
  "GT",
  "DP",
  "AD",
  "GQ",
  "PL",
  "GL",
  "GP",
  "PS",
  "PQ",
  "HQ",
  "MQ",
  "SB",
  "MIN_DP",
  "PGT",
  "PID",
]);

export function groupInfoFields(fields) {
  const byId = (a, b) => String(a?.ID || "").localeCompare(String(b?.ID || ""));
  const popPrefixOrder = ["gnomad", "exac", "1000g", "1000genomes", "1kg"];
  const popSuffixOrder = ["", "afr", "amr", "asj", "eas", "fin", "nfe", "oth", "sas"];
  const parsePopKey = (rawId) => {
    const id = String(rawId || "").toLowerCase();
    const match = id.match(/^(gnomad|exac|1000g|1000genomes|1kg)[_:-](.+)$/i);
    if (!match) return null;

    const prefix = match[1].toLowerCase();
    const remainder = match[2];
    const parts = remainder.split("_");
    const maybeSuffix = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
    const hasKnownSuffix = popSuffixOrder.includes(maybeSuffix);

    return {
      prefix,
      metric: hasKnownSuffix ? parts.slice(0, -1).join("_") : remainder,
      suffix: hasKnownSuffix ? maybeSuffix : "",
    };
  };
  const byPopulationId = (a, b) => {
    const pa = parsePopKey(a?.ID);
    const pb = parsePopKey(b?.ID);
    if (!pa || !pb) return byId(a, b);

    const prefixCmp = popPrefixOrder.indexOf(pa.prefix) - popPrefixOrder.indexOf(pb.prefix);
    if (prefixCmp !== 0) return prefixCmp;

    const metricCmp = pa.metric.localeCompare(pb.metric);
    if (metricCmp !== 0) return metricCmp;

    return popSuffixOrder.indexOf(pa.suffix) - popSuffixOrder.indexOf(pb.suffix);
  };
  const core = [];
  const population = [];
  const other = [];

  for (const field of fields || []) {
    const idRaw = String(field?.ID || "");
    const id = idRaw.toUpperCase();
    const desc = String(field?.Description || "").toLowerCase();
    const isPopulationInfo =
      /^(gnomad|exac|1000g|1000genomes|1kg)[_:-]/i.test(idRaw) ||
      /\bgnomad\b|\bexac\b|\b1000g\b|\b1000 genomes\b|\b1000genomes\b|\b1kg\b/i.test(desc);

    if (CORE_INFO_KEYS.has(id)) core.push(field);
    else if (isPopulationInfo) population.push(field);
    else other.push(field);
  }

  core.sort(byId);
  population.sort(byPopulationId);
  other.sort(byId);
  return { core, population, other };
}

export function groupFormatFields(fields) {
  const byId = (a, b) => String(a?.ID || "").localeCompare(String(b?.ID || ""));
  const core = [];
  const other = [];

  for (const field of fields || []) {
    const id = String(field?.ID || "").toUpperCase();
    if (CORE_FORMAT_KEYS.has(id)) core.push(field);
    else other.push(field);
  }

  core.sort(byId);
  other.sort(byId);
  return { core, other };
}

export function summarizePopulationAnnotations(infoFields) {
  const sources = new Set();
  let totalFields = 0;

  for (const field of infoFields || []) {
    const id = String(field?.ID || "").toLowerCase();
    const desc = String(field?.Description || "").toLowerCase();

    let matched = false;
    const hasGnomad = /^(gnomad)[_:-]/i.test(id) || /\bgnomad\b/i.test(desc);
    const hasExac = /^(exac)[_:-]/i.test(id) || /\bexac\b/i.test(desc);
    const has1000g = /^(1000g|1000genomes|1kg)[_:-]/i.test(id) || /\b1000g\b|\b1000genomes\b|\b1000 genomes\b|\b1kg\b/i.test(desc);

    if (hasGnomad) {
      sources.add("gnomAD");
      matched = true;
    }
    if (hasExac) {
      sources.add("ExAC");
      matched = true;
    }
    if (has1000g) {
      sources.add("1000 Genomes");
      matched = true;
    }

    if (matched) totalFields += 1;
  }

  return {
    sources: Array.from(sources),
    totalFields,
    hasPopulationData: sources.size > 0,
  };
}

export function getInitialTab(parsed) {
  const tabOrder = ["history", "columns", "info", "format", "filter", "contig", "samples", "other"];
  const firstWithData = tabOrder.find((tabId) => (parsed?.[tabId]?.length || 0) > 0);
  return firstWithData || "history";
}
