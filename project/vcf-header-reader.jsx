import { useMemo, useState } from "react";
import { inflateRaw } from "pako";

const COLORS = {
  bg: "#0f1117",
  surface: "#1a1d27",
  border: "#2a2d3e",
  text: "#e8eaf0",
  muted: "#6b7080",
  accent: "#0ea5a3",
  accentDim: "#0ea5a322",
  danger: "#e05c5c",
};

const TONES = {
  teal: { bg: "#103236", border: "#1b5055", value: "#88ece3" },
  blue: { bg: "#10273d", border: "#21466a", value: "#9dccff" },
  violet: { bg: "#221b3f", border: "#3c3370", value: "#c7b8ff" },
  amber: { bg: "#3a2812", border: "#6a4a20", value: "#ffd093" },
  rose: { bg: "#3a1e2f", border: "#6a3653", value: "#f7bbd8" },
  green: { bg: "#1b3320", border: "#2f5a38", value: "#a9e7b6" },
};

const styles = {
  app: {
    minHeight: "100vh",
    background: COLORS.bg,
    color: COLORS.text,
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    padding: "28px 24px",
  },
  header: {
    marginBottom: 20,
    borderBottom: `1px solid ${COLORS.border}`,
    paddingBottom: 14,
  },
  title: {
    margin: 0,
    fontSize: 26,
    fontWeight: 700,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: COLORS.muted,
  },
  card: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  drop: (over) => ({
    border: `1.5px dashed ${over ? COLORS.accent : COLORS.border}`,
    borderRadius: 10,
    padding: "24px 16px",
    textAlign: "center",
    background: over ? COLORS.accentDim : "transparent",
    cursor: "pointer",
    transition: "all .15s",
  }),
  btn: {
    marginTop: 10,
    padding: "8px 14px",
    borderRadius: 8,
    border: `1px solid ${COLORS.border}`,
    background: "transparent",
    color: COLORS.text,
    cursor: "pointer",
    fontSize: 13,
  },
  status: (type) => ({
    display: "block",
    borderRadius: 8,
    padding: "8px 10px",
    marginBottom: 12,
    fontSize: 13,
    background: type === "error" ? "#3a1f24" : "#1b2c30",
    color: type === "error" ? COLORS.danger : COLORS.text,
  }),
  fileInfo: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  infoPill: (tone) => ({
    border: `1px solid ${tone.border}`,
    borderRadius: 8,
    background: tone.bg,
    padding: "8px 10px",
    minWidth: 150,
  }),
  infoLabel: {
    display: "block",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: COLORS.muted,
    marginBottom: 4,
  },
  infoValue: (tone) => ({
    display: "block",
    fontSize: 14,
    fontWeight: 700,
    color: tone.value,
    lineHeight: 1.2,
    wordBreak: "break-word",
  }),
  tabs: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 12,
    paddingBottom: 2,
  },
  tab: (active, tone) => ({
    border: `1px solid ${active ? tone.border : COLORS.border}`,
    background: active ? tone.bg : "#141923",
    color: active ? tone.value : COLORS.text,
    padding: "10px 12px",
    borderRadius: 10,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    transition: "all .15s",
    textAlign: "left",
    minHeight: 66,
  }),
  tabLabel: {
    display: "block",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: COLORS.muted,
    marginBottom: 4,
  },
  tabCount: (active, tone) => ({
    display: "block",
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 1,
    color: active ? tone.value : COLORS.text,
  }),
  tableWrap: {
    overflow: "auto",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: COLORS.muted,
    padding: "8px 10px",
    borderBottom: `1px solid ${COLORS.border}`,
    background: "#1f2431",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "8px 10px",
    borderBottom: `1px solid ${COLORS.border}`,
    verticalAlign: "top",
  },
  mono: {
    fontFamily: "'DM Mono', 'Courier New', monospace",
    fontSize: 12,
  },
  codeBlock: {
    background: "#141923",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: "10px 12px",
    fontFamily: "'DM Mono', 'Courier New', monospace",
    fontSize: 12,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    marginBottom: 10,
  },
  historyCard: (tone) => ({
    border: `1px solid ${tone.border}`,
    borderRadius: 12,
    background: tone.bg,
    padding: 12,
    marginBottom: 12,
  }),
  historyHeaderRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
    marginBottom: 10,
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: 800,
    color: COLORS.text,
    lineHeight: 1.2,
  },
  historySubline: {
    marginTop: 3,
    fontSize: 12,
    color: COLORS.muted,
    lineHeight: 1.4,
  },
  historyBadge: (tone) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    padding: "4px 8px",
    border: `1px solid ${tone.border}`,
    background: "rgba(255,255,255,0.06)",
    color: tone.value,
    fontSize: 11,
    fontWeight: 700,
  }),
  historySection: {
    marginTop: 10,
  },
  historySectionLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: COLORS.muted,
    marginBottom: 6,
    fontWeight: 700,
  },
  historyOptionsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 8,
  },
  historyOption: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    background: "#141923",
    padding: "8px 10px",
  },
  historyOptionKey: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: COLORS.muted,
    marginBottom: 3,
    fontWeight: 700,
    wordBreak: "break-word",
  },
  historyOptionValue: {
    fontSize: 12,
    color: COLORS.text,
    wordBreak: "break-word",
    lineHeight: 1.35,
  },
  historyGreyBox: {
    background: "#1d222e",
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    padding: "10px 12px",
  },
  nullOptionsBox: {
    marginTop: 10,
    border: `1px solid ${TONES.amber.border}`,
    borderRadius: 10,
    background: "#2f2416",
    padding: "12px 14px",
  },
  nullOptionsTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: TONES.amber.value,
    fontWeight: 800,
    marginBottom: 6,
  },
  nullOptionsText: {
    fontSize: 12,
    lineHeight: 1.45,
    color: COLORS.text,
    wordBreak: "break-word",
  },
  helpIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 6,
    width: 16,
    height: 16,
    borderRadius: 999,
    border: `1px solid ${COLORS.border}`,
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: 700,
    cursor: "help",
    userSelect: "none",
  },
};

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

function toolFamily(key, rawVal = "") {
  const k = String(key || "").toLowerCase();
  const v = String(rawVal || "").toLowerCase();

  const has = (needle) => k.includes(needle) || v.includes(needle);

  if (k.startsWith("bcftools")) return "bcftools";
  if (k.startsWith("gatk")) return "gatk";
  if (k.startsWith("picard") || k.includes("picard")) return "picard";
  if (k.startsWith("samtools")) return "samtools";
  if (k.startsWith("snpeff") || k.startsWith("snpsift")) return "snpeff";
  if (has("mutect") || has("genotypegvcfs") || has("combinevariants") || has("haplotypecaller")) return "gatk";
  if (has("freebayes")) return "freebayes";
  if (has("bcftools")) return "bcftools";
  if (has("gatk")) return "gatk";
  if (has("picard")) return "picard";
  if (has("samtools")) return "samtools";
  if (has("snpeff") || has("snpsift")) return "snpeff";
  return "other";
}

function normalizeCommandValue(rawVal) {
  let value = String(rawVal || "").trim();
  if (!value) return value;

  // Remove surrounding quote pair from values like
  // ".../freebayes ..." so history renders clean commands.
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

function tokenizeCommandText(text) {
  const input = String(text || "").trim();
  if (!input) return [];

  const tokens = [];
  let current = "";
  let quote = null;
  let squareDepth = 0;
  let roundDepth = 0;
  let curlyDepth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

    if (quote) {
      if (ch === "\\" && i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        quote = null;
        continue;
      }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === "[") squareDepth += 1;
    else if (ch === "]" && squareDepth > 0) squareDepth -= 1;
    else if (ch === "(") roundDepth += 1;
    else if (ch === ")" && roundDepth > 0) roundDepth -= 1;
    else if (ch === "{") curlyDepth += 1;
    else if (ch === "}" && curlyDepth > 0) curlyDepth -= 1;

    if (/\s/.test(ch) && squareDepth === 0 && roundDepth === 0 && curlyDepth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

function splitKeyValueToken(token) {
  const value = String(token || "").trim();
  if (!value) return null;

  const eq = value.indexOf("=");
  if (eq === -1) return { key: value, value: "true" };

  return {
    key: value.slice(0, eq).trim(),
    value: value.slice(eq + 1).trim(),
  };
}

function parseOptionTokens(text) {
  const tokens = tokenizeCommandText(text);
  const options = [];

  for (const token of tokens) {
    const pair = splitKeyValueToken(token);
    if (!pair) continue;
    options.push({ ...pair, source: "structured" });
  }

  return options;
}

function parseDashedCommandOptions(commandText) {
  const parsed = parseCommandTokens(commandText);
  if (!parsed) return [];

  const out = [];
  for (const arg of parsed.args || []) {
    const key = String(arg?.key || "").trim();
    if (!key.startsWith("-") || key === "-") continue;

    let value = arg?.value;
    if (value === "true") value = null;

    out.push({ key, value, source: "derived" });
  }

  return out;
}

function formatOptionHeader(option, fallbackIndex) {
  const key = String(option?.key || "").trim();
  if (!key) return `Argument ${fallbackIndex + 1}`;

  if (option?.source === "derived") {
    const cleaned = key.replace(/^-+/, "").replace(/-/g, " ").trim();
    return cleaned || `Argument ${fallbackIndex + 1}`;
  }

  return key;
}

function formatOptionValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "true";
  if (value === "") return '""';
  return String(value);
}

function parseCommandTokens(text) {
  const tokens = tokenizeCommandText(text);
  if (tokens.length === 0) return null;

  const executable = tokens[0];
  const args = [];

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    if (token.startsWith("-") && token.includes("=")) {
      const eq = token.indexOf("=");
      args.push({ key: token.slice(0, eq), value: token.slice(eq + 1) });
      continue;
    }

    if (token.startsWith("-")) {
      const next = tokens[i + 1];
      if (next && !next.startsWith("-")) {
        args.push({ key: token, value: next });
        i += 1;
      } else {
        args.push({ key: token, value: "true" });
      }
      continue;
    }

    args.push({ key: "", value: token });
  }

  return { executable, args };
}

function normalizeSoftwareName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function prettySoftwareLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^bcftools$/i.test(raw)) return "bcftools";
  if (/^gatk$/i.test(raw)) return "GATK";
  if (/^freebayes$/i.test(raw)) return "freebayes";
  if (/^mutect2$/i.test(raw)) return "Mutect2";
  if (/^genotypegvcfs$/i.test(raw)) return "GenotypeGVCFs";
  if (/^combinevariants$/i.test(raw)) return "CombineVariants";
  if (/^haplotypecaller$/i.test(raw)) return "HaplotypeCaller";
  if (/^picard$/i.test(raw)) return "Picard";
  if (/^samtools$/i.test(raw)) return "samtools";
  if (/^snpeff$/i.test(raw)) return "snpEff";
  if (/^snpsift$/i.test(raw)) return "SnpSift";

  return raw;
}

function resolveHistoryToolLabel(key, rawVal, structured = null) {
  const keyLower = String(key || "").toLowerCase();
  const val = normalizeCommandValue(rawVal);
  const valLower = val.toLowerCase();
  const id = String(structured?.ID || "").trim();

  if (keyLower.startsWith("bcftools")) {
    const sub = key
      .replace(/^bcftools_?/i, "")
      .replace(/Command(?:Line)?$/i, "")
      .replace(/Version$/i, "")
      .trim();
    return `bcftools${sub ? ` ${sub}` : ""}`;
  }

  if (keyLower.startsWith("gatkcommandline")) {
    if (id) return `GATK ${id}`;
    const suffix = key.includes(".") ? key.slice(key.indexOf(".") + 1).trim() : "";
    return suffix ? `GATK ${suffix}` : "GATK";
  }

  if (keyLower.endsWith("version")) {
    const base = key.replace(/Version$/i, "").replace(/[_-]+$/g, "").trim();
    if (base) return prettySoftwareLabel(base);
  }

  if (keyLower.includes("mutect")) return id ? `Mutect ${id}` : "Mutect";
  if (keyLower.includes("genotypegvcfs")) return "GenotypeGVCFs";
  if (keyLower.includes("combinevariants")) return "CombineVariants";
  if (keyLower.includes("haplotypecaller")) return "HaplotypeCaller";
  if (keyLower.includes("freebayes") || valLower.includes("freebayes")) return "freebayes";
  if (keyLower.includes("picard")) return "Picard";
  if (keyLower.includes("samtools")) return "samtools";
  if (keyLower.includes("snpeff")) return "snpEff";
  if (keyLower.includes("snpsift")) return "SnpSift";

  return prettySoftwareLabel(key.replace(/[_]?Command(?:Line)?$/i, "").replace(/[_-]+$/g, "").trim()) || key;
}

function normalizeHistoryGroupKey(label, family = "other") {
  const normalizedFamily = String(family || "other").toLowerCase();
  return `${normalizedFamily}:${normalizeSoftwareName(label)}`;
}

function splitTrailingDate(value) {
  const text = normalizeCommandValue(value);
  const match = text.match(/^(.*?)(?:\s*;\s*Date\s*=\s*)(.+)$/i);
  if (!match) {
    return { text, date: null };
  }

  return {
    text: (match[1] || "").trim(),
    date: (match[2] || "").trim() || null,
  };
}

function parseHistoryEntry(key, rawVal) {
  const keyLower = String(key || "").toLowerCase();
  const normalizedVal = normalizeCommandValue(rawVal);
  const withTrailingDate = splitTrailingDate(normalizedVal);
  const structured = normalizedVal.startsWith("<") && normalizedVal.endsWith(">") ? parseStructuredField(normalizedVal) : null;
  const family = toolFamily(key, normalizedVal);
  const tool = resolveHistoryToolLabel(key, normalizedVal, structured);
  const id = structured?.ID || null;
  const version = structured?.Version || null;
  const date = structured?.Date || withTrailingDate.date || null;
  const epoch = structured?.Epoch || null;
  const commandLine = structured?.CommandLine || null;
  const commandLineOptions = structured?.CommandLineOptions || null;
  const commandText = commandLine || commandLineOptions || withTrailingDate.text;
  const command = commandText && !commandText.startsWith("<") ? commandText : normalizedVal;
  const options = commandLineOptions
    ? parseOptionTokens(commandLineOptions)
    : parseDashedCommandOptions(commandLine || withTrailingDate.text);
  const structuredExtras = structured
    ? Object.entries(structured)
        .filter(([field]) => !["ID", "Version", "Date", "Epoch", "CommandLine", "CommandLineOptions"].includes(field))
        .map(([field, value]) => ({ field, value }))
    : [];

  return {
    key,
    tool,
    family,
    id,
    version,
    date,
    epoch,
    command: command.trim(),
    commandLine,
    commandLineOptions,
    options,
    structuredExtras,
    raw: normalizedVal,
    groupKey: normalizeHistoryGroupKey(tool, family),
  };
}

function mergeHistoryEntries(entries) {
  const merged = [];

  for (const entry of entries) {
    const labelKey = entry.groupKey || normalizeHistoryGroupKey(entry.tool, entry.family);
    const baseKey = normalizeSoftwareName(labelKey);
    const existingIndex = merged.findIndex((candidate) => {
      const candidateKey = candidate.groupKey || normalizeHistoryGroupKey(candidate.tool, candidate.family);
      const normalizedCandidate = normalizeSoftwareName(candidateKey);
      return (
        normalizedCandidate === baseKey ||
        normalizedCandidate.includes(baseKey) ||
        baseKey.includes(normalizedCandidate)
      );
    });

    if (existingIndex !== -1) {
      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        version: existing.version || entry.version,
        date: existing.date || entry.date,
        epoch: existing.epoch || entry.epoch,
        command: existing.command || entry.command,
        commandLine: existing.commandLine || entry.commandLine,
        commandLineOptions: existing.commandLineOptions || entry.commandLineOptions,
        options: existing.options.length ? existing.options : entry.options,
        structuredExtras: existing.structuredExtras.length ? existing.structuredExtras : entry.structuredExtras,
      };
      continue;
    }

    merged.push(entry);
  }

  return merged;
}

function isNullLikeOptionValue(value) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  return trimmed === "" || trimmed === "null" || trimmed === "[]";
}

function extractHistory(lines) {
  const history = [];
  const nonHistorySchemaKeys = new Set([
    "info",
    "format",
    "filter",
    "contig",
    "alt",
    "sample",
    "pedigree",
    "meta",
    "assembly",
    "reference",
    "source",
    "phasing",
    "filedate",
    "fileformat",
  ]);
  const toolHintRegex = /(gatk|bcftools|mutect|freebayes|picard|samtools|snpeff|snpsift|genotypegvcfs|combinevariants|haplotypecaller)/i;

  for (const line of lines) {
    if (!line.startsWith("##")) continue;
    const rest = line.slice(2);
    const eqIdx = rest.indexOf("=");
    if (eqIdx === -1) continue;

    const key = rest.slice(0, eqIdx);
    const rawVal = rest.slice(eqIdx + 1);

    const keyLower = key.toLowerCase();
    const valLower = rawVal.toLowerCase();
  const looksStructuredSchemaValue = rawVal.trim().startsWith("<") && rawVal.includes("ID=");

  if (nonHistorySchemaKeys.has(keyLower) && looksStructuredSchemaValue) continue;

  const hasCommandKey = /(command|commandline|commandlineoptions)/i.test(keyLower);
  const hasKnownToolSignal = toolHintRegex.test(`${keyLower} ${valLower}`);
  const hasVersionKey = /version$/i.test(keyLower) && hasKnownToolSignal;
    const hasGatkCommandKey = keyLower.startsWith("gatkcommandline");
    const hasFreeBayesSignal = keyLower.includes("freebayes") || valLower.includes("freebayes");
    const sourceCarriesFreeBayes = keyLower === "source" && hasFreeBayesSignal;

    if (!hasCommandKey && !hasVersionKey && !hasFreeBayesSignal && !sourceCarriesFreeBayes && !hasGatkCommandKey) continue;

    const entry = parseHistoryEntry(key, rawVal);
    if (!entry.command && !entry.version && !entry.commandLine && !entry.commandLineOptions) continue;
    history.push(entry);
  }

  return mergeHistoryEntries(history);
}

function parseVCFHeader(text) {
  const lines = text.split("\n");
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
    samples: [],
    other: [],
    history: [],
  };

    const promotedKeys = new Set([
      "fileformat",
      "filedate",
      "reference",
      "assembly",
      "source",
      "phasing",
    ]);

  for (const line of lines) {
    if (!line || !line.startsWith("#")) continue;
    if (line.startsWith("##fileformat=")) out.fileformat = line.slice(13).trim();
    else if (line.startsWith("##fileDate=")) {
      out.fileDate = line.slice(11).trim();
    }
    else if (line.startsWith("##reference=")) out.reference = line.slice(12).trim();
    else if (line.startsWith("##assembly=")) out.assembly = line.slice(11).trim();
    else if (line.startsWith("##source=")) out.source = line.slice(9).trim();
    else if (line.startsWith("##phasing=")) out.phasing = line.slice(10).trim();
    else if (line.startsWith("##INFO=")) out.info.push(parseStructuredField(line.slice(7)));
    else if (line.startsWith("##FORMAT=")) out.format.push(parseStructuredField(line.slice(9)));
    else if (line.startsWith("##FILTER=")) out.filter.push(parseStructuredField(line.slice(9)));
    else if (line.startsWith("##contig=")) out.contig.push(parseStructuredField(line.slice(9)));
    else if (line.startsWith("##")) {
      const key = line.slice(2).split("=", 1)[0].toLowerCase();
      if (!promotedKeys.has(key)) out.other.push({ raw: line.slice(2) });
    }
    else if (line.startsWith("#CHROM")) {
      const cols = line.split("\t");
      out.columns = cols.map((column, index) => (index === 0 ? column.replace(/^#/, "") : column)).filter(Boolean);
      out.samples = cols.slice(9).filter(Boolean);
    }
  }

  out.history = extractHistory(lines);
  return out;
}

function formatVcfFileDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  // First try natural date parsing to handle values like
  // "January-20-2023 at 11:12 UTC" correctly.
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

  // Fallback for compact VCF-like forms such as YYYYMMDD or YYYYMMDDTHHMMSS.
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

const REFERENCE_SIGNATURES = [
  {
    name: "GRCh38",
    aliases: ["hg38"],
    contigs: {
      "1": 248956422,
      "2": 242193529,
      X: 156040895,
      Y: 57227415,
      MT: 16569,
    },
  },
  {
    name: "GRCh37",
    aliases: ["hg19"],
    contigs: {
      "1": 249250621,
      "2": 243199373,
      X: 155270560,
      Y: 59373566,
      MT: 16569,
    },
  },
  {
    name: "T2T-CHM13",
    aliases: ["hs1"],
    contigs: {
      "1": 248387328,
      "2": 242696752,
      X: 154259566,
      Y: 62460029,
      MT: 16569,
    },
  },
];

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

function inferReferenceFromContigs(contigs) {
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

function getDisplayedColumns(columns) {
  return Array.isArray(columns) ? columns : [];
}

function detectFormat(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".bcf")) return "BCF";
  if (lower.endsWith(".vcf.gz") || lower.endsWith(".gz")) return "VCF.GZ";
  return "VCF";
}

function readSlice(file, start, end) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file.slice(start, end));
  });
}

function readSliceText(file, start, end) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file.slice(start, end));
  });
}

async function readVCFHeader(file) {
  const chunkSize = 65536;
  let offset = 0;
  let tail = "";
  let fullHeader = "";

  while (offset < file.size) {
    const chunk = await readSliceText(file, offset, offset + chunkSize);
    const text = tail + chunk;
    const lines = text.split("\n");

    for (let i = 0; i < lines.length - 1; i += 1) {
      if (lines[i] && !lines[i].startsWith("#")) {
        return fullHeader + lines.slice(0, i).join("\n");
      }
    }

    fullHeader += `${lines.slice(0, -1).join("\n")}\n`;
    tail = lines[lines.length - 1];
    offset += chunkSize;
  }

  return fullHeader + tail;
}

async function readVCFGZHeader(file) {
  const maxRead = Math.min(file.size, 10 * 1024 * 1024);
  const buffer = await readSlice(file, 0, maxRead);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  let offset = 0;
  let text = "";

  while (offset + 18 < bytes.length) {
    // GZIP magic header check
    if (bytes[offset] !== 0x1f || bytes[offset + 1] !== 0x8b) break;

    const flg = bytes[offset + 3];
    let pos = offset + 10;
    let blockSize = 0;

    // BGZF block has FEXTRA set with BC subfield that stores block size.
    if (flg & 0x04) {
      const xlen = view.getUint16(pos, true);
      pos += 2;
      const xEnd = pos + xlen;

      while (pos < xEnd) {
        const si1 = bytes[pos];
        const si2 = bytes[pos + 1];
        const slen = view.getUint16(pos + 2, true);

        if (si1 === 0x42 && si2 === 0x43) {
          blockSize = view.getUint16(pos + 4, true) + 1;
        }

        pos += 4 + slen;
      }
    }

    if (!blockSize) {
      throw new Error("Unsupported .vcf.gz layout (expected BGZF blocks)");
    }

    const compressedEnd = offset + blockSize - 8; // exclude CRC32 + ISIZE footer
    if (compressedEnd > bytes.length) break;

    const compressedData = bytes.slice(pos, compressedEnd);
    text += inflateRaw(compressedData, { to: "string" });
    offset += blockSize;

    const lines = text.split("\n");
    if (lines.some((line) => line && !line.startsWith("#"))) {
      break;
    }
  }

  return text;
}

async function readBCFHeader(file) {
  const header = await readSlice(file, 0, 9);
  const view = new DataView(header);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2));
  if (magic !== "BCF") throw new Error("Not a BCF file");

  const textLength = view.getUint32(5, true);
  const textBuffer = await readSlice(file, 9, 9 + textLength);
  return new TextDecoder().decode(textBuffer);
}

function TypeTag({ value }) {
  const colorMap = {
    Integer: ["#e6f1fb", "#0c447c"],
    Float: ["#e1f5ee", "#085041"],
    String: ["#faece7", "#993c1d"],
    Flag: ["#faeeda", "#854f0b"],
    Character: ["#fbeaf0", "#72243e"],
  };

  const [bg, fg] = colorMap[value] || ["#f1efe8", "#5f5e5a"];

  return (
    <span
      style={{
        display: "inline-block",
        borderRadius: 4,
        padding: "2px 6px",
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        color: fg,
      }}
    >
      {value || "-"}
    </span>
  );
}

// VCF does not require specific INFO IDs, but these are commonly treated as core/standard tags.
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

function groupInfoFields(fields) {
  const core = [];
  const other = [];

  for (const field of fields || []) {
    const id = String(field?.ID || "").toUpperCase();
    if (CORE_INFO_KEYS.has(id)) core.push(field);
    else other.push(field);
  }

  return { core, other };
}

function groupFormatFields(fields) {
  const core = [];
  const other = [];

  for (const field of fields || []) {
    const id = String(field?.ID || "").toUpperCase();
    if (CORE_FORMAT_KEYS.has(id)) core.push(field);
    else other.push(field);
  }

  return { core, other };
}

function getTabTone(tabId) {
  const map = {
    history: TONES.violet,
    columns: TONES.blue,
    samples: TONES.blue,
    contig: TONES.green,
    info: TONES.teal,
    format: TONES.amber,
    filter: TONES.rose,
    other: TONES.blue,
  };

  return map[tabId] || TONES.teal;
}

function getHistoryTone(family) {
  const normalized = String(family || "other").toLowerCase();
  const map = {
    gatk: TONES.violet,
    bcftools: TONES.blue,
    freebayes: TONES.teal,
    picard: TONES.amber,
    samtools: TONES.green,
    snpeff: TONES.rose,
    other: TONES.blue,
  };

  return map[normalized] || TONES.blue;
}

export default function VcfHeaderReaderApp() {
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState(null);
  const [activeTab, setActiveTab] = useState("history");
  const [result, setResult] = useState(null);

  const tabs = useMemo(() => {
    if (!result) return [];
    const p = result.parsed;

    return [
      p.history.length ? { id: "history", label: "History", count: p.history.length } : null,
      p.columns.length ? { id: "columns", label: "Columns", count: p.columns.length } : null,
      p.info.length ? { id: "info", label: "INFO", count: p.info.length } : null,
      p.format.length ? { id: "format", label: "FORMAT", count: p.format.length } : null,
      p.filter.length ? { id: "filter", label: "FILTER", count: p.filter.length } : null,
      p.contig.length ? { id: "contig", label: "Contigs", count: p.contig.length } : null,
      { id: "samples", label: "Samples", count: p.samples.length || 0 },
      p.other.length ? { id: "other", label: "Other", count: p.other.length } : null,
    ].filter(Boolean);
  }, [result]);

  const inferredReference = useMemo(() => {
    if (!result?.parsed?.contig) return null;
    return inferReferenceFromContigs(result.parsed.contig);
  }, [result]);

  const handleFile = async (file) => {
    try {
      setStatus({ type: "loading", text: "Reading header..." });
      setResult(null);

      const format = detectFormat(file.name);
      let headerText = "";

      if (format === "BCF") headerText = await readBCFHeader(file);
      else if (format === "VCF.GZ") headerText = await readVCFGZHeader(file);
      else headerText = await readVCFHeader(file);

      const parsed = parseVCFHeader(headerText);
      setResult({ file, format, parsed });

      const firstTab = parsed.history.length
        ? "history"
        : parsed.columns.length
          ? "columns"
        : parsed.info.length
          ? "info"
          : parsed.format.length
            ? "format"
            : parsed.filter.length
              ? "filter"
              : parsed.contig.length
                ? "contig"
                : parsed.samples.length
                  ? "samples"
                  : parsed.other.length
                    ? "other"
                    : "samples";
      setActiveTab(firstTab);
      setStatus(null);
    } catch (error) {
      setStatus({ type: "error", text: `Error: ${error.message}` });
    }
  };

  const onDrop = async (event) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const onChoose = async (event) => {
    const file = event.target.files?.[0];
    if (file) await handleFile(file);
  };

  const parsed = result?.parsed;
  const displayedColumns = getDisplayedColumns(parsed?.columns);

  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <h1 style={styles.title}>VCF Header Reader</h1>
        <p style={styles.subtitle}>
          Inspect VCF, VCF.GZ, or BCF headers without parsing full variant records.
        </p>
      </div>

      <div style={styles.card}>
        <label
          style={styles.drop(dragOver)}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <div style={{ fontSize: 15, fontWeight: 600 }}>Drop a VCF / VCF.GZ / BCF file here</div>
          <div style={{ marginTop: 6, fontSize: 12, color: COLORS.muted }}>
            Reads header metadata only.
          </div>
          <input
            type="file"
            accept=".vcf,.vcf.gz,.bcf,.gz"
            style={{ display: "none" }}
            onChange={onChoose}
          />
          <button type="button" style={styles.btn}>
            Choose file
          </button>
        </label>
      </div>

      {status ? <div style={styles.status(status.type)}>{status.text}</div> : null}

      {result ? (
        <div style={styles.card}>
          <div style={styles.fileInfo}>
            <div style={styles.infoPill(TONES.violet)}>
              <span style={styles.infoLabel}>File</span>
              <span style={styles.infoValue(TONES.violet)}>{result.file.name}</span>
            </div>
            <div style={styles.infoPill(TONES.blue)}>
              <span style={styles.infoLabel}>Size</span>
              <span style={styles.infoValue(TONES.blue)}>{(result.file.size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
            <div style={styles.infoPill(TONES.teal)}>
              <span style={styles.infoLabel}>Format</span>
              <span style={styles.infoValue(TONES.teal)}>{result.format}</span>
            </div>
            {parsed.fileformat ? (
              <div style={styles.infoPill(TONES.amber)}>
                <span style={styles.infoLabel}>VCF Version</span>
                <span style={styles.infoValue(TONES.amber)}>{parsed.fileformat}</span>
              </div>
            ) : null}
            {parsed.fileDate ? (
              <div style={styles.infoPill(TONES.amber)}>
                <span style={styles.infoLabel}>File Date</span>
                <span style={styles.infoValue(TONES.amber)}>{formatVcfFileDate(parsed.fileDate)}</span>
              </div>
            ) : null}
            {parsed.source ? (
              <div style={styles.infoPill(TONES.teal)}>
                <span style={styles.infoLabel}>Source</span>
                <span style={styles.infoValue(TONES.teal)}>{parsed.source}</span>
              </div>
            ) : null}
            {parsed.phasing ? (
              <div style={styles.infoPill(TONES.blue)}>
                <span style={styles.infoLabel}>Phasing</span>
                <span style={styles.infoValue(TONES.blue)}>{parsed.phasing}</span>
              </div>
            ) : null}
            {parsed.reference || parsed.assembly || inferredReference ? (
              <div style={styles.infoPill(TONES.rose)}>
                <span style={styles.infoLabel}>
                  Reference
                  {inferredReference ? (
                    <span
                      style={styles.helpIcon}
                      title={`Declared reference: ${parsed.reference || parsed.assembly || "(none)"}\nInferred reference: ${inferredReference.build}${inferredReference.aliases?.length ? ` (${inferredReference.aliases.join("/")})` : ""}\nInference based on exact contig length matches. Matched contigs: ${inferredReference.matchedContigs.join(", ")} (${inferredReference.matched}/${inferredReference.compared}).`}
                    >
                      ?
                    </span>
                  ) : null}
                </span>
                <span style={styles.infoValue(TONES.rose)}>{parsed.reference || parsed.assembly || inferredReference.build}</span>
                {inferredReference ? (
                  <span style={{ ...styles.infoLabel, marginTop: 4, marginBottom: 0 }}>
                    Inferred: {inferredReference.build}
                    {inferredReference.aliases?.length ? ` (${inferredReference.aliases.join("/")})` : ""}
                    {` • ${inferredReference.confidence} confidence`}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div style={styles.tabs}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                style={styles.tab(activeTab === tab.id, getTabTone(tab.id))}
                onClick={() => setActiveTab(tab.id)}
              >
                <span style={styles.tabLabel}>{tab.label}</span>
                <span style={styles.tabCount(activeTab === tab.id, getTabTone(tab.id))}>
                  {tab.count.toLocaleString()}
                </span>
              </button>
            ))}
          </div>

          {activeTab === "history" ? (
            parsed.history.length ? (
              <div>
                {parsed.history.map((h, i) => (
                  <div key={`${h.tool}-${i}`} style={styles.historyCard(getHistoryTone(h.family))}>
                    {(() => {
                      const normalOptions = (h.options || []).filter(
                        (option) => option.source === "derived" || !isNullLikeOptionValue(option.value)
                      );
                      const nullOptionKeys = (h.options || [])
                        .filter((option) => option.source !== "derived" && isNullLikeOptionValue(option.value))
                        .map((option) => option.key)
                        .filter(Boolean);

                      return (
                        <>
                    <div style={styles.historyHeaderRow}>
                      <div>
                        <div style={styles.historyTitle}>{h.tool}</div>
                        <div style={styles.historySubline}>
                          {h.id ? `ID: ${h.id}` : h.key ? `Header: ${h.key}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {h.family ? <span style={styles.historyBadge(getHistoryTone(h.family))}>{h.family}</span> : null}
                        {h.version ? <span style={styles.historyBadge(TONES.amber)}>v{h.version}</span> : null}
                        {h.date ? <span style={styles.historyBadge(TONES.blue)}>{h.date}</span> : null}
                        {h.epoch ? <span style={styles.historyBadge(TONES.teal)}>Epoch: {h.epoch}</span> : null}
                      </div>
                    </div>

                    {h.options.length ? (
                      <div style={styles.historySection}>
                        <div style={styles.historySectionLabel}>Command options</div>
                        {normalOptions.length ? (
                          <div style={styles.historyOptionsGrid}>
                            {normalOptions.map((option, optionIndex) => (
                              <div key={`${option.key}-${optionIndex}`} style={styles.historyOption}>
                                <div style={styles.historyOptionKey}>{formatOptionHeader(option, optionIndex)}</div>
                                <div style={styles.historyOptionValue}>{formatOptionValue(option.value)}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {nullOptionKeys.length ? (
                          <div style={styles.nullOptionsBox}>
                            <div style={styles.nullOptionsTitle}>NULL OPTIONS</div>
                            <div style={styles.nullOptionsText}>{nullOptionKeys.join(", ")}</div>
                          </div>
                        ) : null}

                        {h.commandLineOptions ? (
                          <div style={styles.historySection}>
                            <div style={styles.historySectionLabel}>CommandLineOptions (raw text)</div>
                            <div style={styles.codeBlock}>{h.commandLineOptions}</div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {h.structuredExtras.length ? (
                      <div style={styles.historySection}>
                        <div style={styles.historySectionLabel}>Other fields</div>
                        <div style={styles.historyGreyBox}>
                          {h.structuredExtras.map((field, fieldIndex) => (
                            <div
                              key={`${field.field}-${fieldIndex}`}
                              style={{
                                display: "flex",
                                gap: 8,
                                flexWrap: "wrap",
                                marginBottom: fieldIndex === h.structuredExtras.length - 1 ? 0 : 6,
                              }}
                            >
                              <span style={{ ...styles.mono, color: COLORS.muted, minWidth: 110 }}>{field.field}</span>
                              <span style={{ ...styles.mono, color: COLORS.text, wordBreak: "break-word" }}>{field.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {(h.commandLine || (h.command && !h.commandLineOptions)) ? (
                      <div style={styles.historySection}>
                        <div style={styles.historySectionLabel}>{h.commandLine ? "Command line" : "Command"}</div>
                        <div style={styles.codeBlock}>{h.commandLine || h.command}</div>
                      </div>
                    ) : null}
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: COLORS.muted, fontSize: 13 }}>No command history found in this header.</div>
            )
          ) : null}

          {activeTab === "columns" ? (
            displayedColumns.length ? (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Position</th>
                      <th style={styles.th}>Column</th>
                      <th style={styles.th}>Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedColumns.map((column, index) => (
                      <tr key={`${column}-${index}`}>
                        <td style={{ ...styles.td, ...styles.mono }}>{index + 1}</td>
                        <td style={{ ...styles.td, ...styles.mono }}>{column}</td>
                        <td style={styles.td}>{index < 9 ? "Core VCF column" : "Sample"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: COLORS.muted, fontSize: 13 }}>No column header line found</div>
            )
          ) : null}

          {activeTab === "info" ? (
            parsed.info.length ? (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Number</th>
                      <th style={styles.th}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const grouped = groupInfoFields(parsed.info);
                      const rows = [];

                      grouped.core.forEach((f, i) => {
                        rows.push(
                          <tr key={`core-${i}`}>
                            <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                            <td style={styles.td}><TypeTag value={f.Type} /></td>
                            <td style={{ ...styles.td, ...styles.mono }}>{f.Number || ""}</td>
                            <td style={styles.td}>{f.Description || ""}</td>
                          </tr>
                        );
                      });

                      if (grouped.core.length > 0 && grouped.other.length > 0) {
                        rows.push(
                          <tr key="core-divider">
                            <td
                              colSpan={4}
                              style={{
                                ...styles.td,
                                borderBottom: `2px solid ${COLORS.border}`,
                                background: "#161c27",
                                color: COLORS.muted,
                                fontSize: 11,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                              }}
                            >
                              Other INFO fields
                            </td>
                          </tr>
                        );
                      }

                      grouped.other.forEach((f, i) => {
                        rows.push(
                          <tr key={`other-${i}`}>
                            <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                            <td style={styles.td}><TypeTag value={f.Type} /></td>
                            <td style={{ ...styles.td, ...styles.mono }}>{f.Number || ""}</td>
                            <td style={styles.td}>{f.Description || ""}</td>
                          </tr>
                        );
                      });

                      return rows;
                    })()}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>
            )
          ) : null}

          {activeTab === "format" ? (
            parsed.format.length ? (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Number</th>
                      <th style={styles.th}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const grouped = groupFormatFields(parsed.format);
                      const rows = [];

                      grouped.core.forEach((f, i) => {
                        rows.push(
                          <tr key={`core-format-${i}`}>
                            <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                            <td style={styles.td}><TypeTag value={f.Type} /></td>
                            <td style={{ ...styles.td, ...styles.mono }}>{f.Number || ""}</td>
                            <td style={styles.td}>{f.Description || ""}</td>
                          </tr>
                        );
                      });

                      if (grouped.core.length > 0 && grouped.other.length > 0) {
                        rows.push(
                          <tr key="core-format-divider">
                            <td
                              colSpan={4}
                              style={{
                                ...styles.td,
                                borderBottom: `2px solid ${COLORS.border}`,
                                background: "#161c27",
                                color: COLORS.muted,
                                fontSize: 11,
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                              }}
                            >
                              Other FORMAT fields
                            </td>
                          </tr>
                        );
                      }

                      grouped.other.forEach((f, i) => {
                        rows.push(
                          <tr key={`other-format-${i}`}>
                            <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                            <td style={styles.td}><TypeTag value={f.Type} /></td>
                            <td style={{ ...styles.td, ...styles.mono }}>{f.Number || ""}</td>
                            <td style={styles.td}>{f.Description || ""}</td>
                          </tr>
                        );
                      });

                      return rows;
                    })()}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>
            )
          ) : null}

          {activeTab === "filter" ? (
            parsed.filter.length ? (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>ID</th>
                      <th style={styles.th}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.filter.map((f, i) => (
                      <tr key={i}>
                        <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                        <td style={styles.td}>{f.Description || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>
            )
          ) : null}

          {activeTab === "contig" ? (
            parsed.contig.length ? (
              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Contig ID</th>
                      <th style={styles.th}>Length (bp)</th>
                      <th style={styles.th}>Other attributes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.contig.map((f, i) => (
                      <tr key={i}>
                        <td style={{ ...styles.td, ...styles.mono }}>{f.ID || ""}</td>
                        <td style={{ ...styles.td, ...styles.mono }}>
                          {f.length ? Number(f.length).toLocaleString() : ""}
                        </td>
                        <td style={styles.td}>
                          {Object.entries(f)
                            .filter(([k]) => k !== "ID" && k !== "length")
                            .map(([k, v]) => `${k}=${v}`)
                            .join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>
            )
          ) : null}

          {activeTab === "samples" ? (
            parsed.samples.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {parsed.samples.map((s, i) => (
                  <span
                    key={`${s}-${i}`}
                    style={{
                      background: "#141923",
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 4,
                      padding: "3px 8px",
                      fontSize: 12,
                      fontFamily: "'DM Mono', 'Courier New', monospace",
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <div style={{ color: COLORS.muted, fontSize: 13 }}>No samples in header</div>
            )
          ) : null}

          {activeTab === "other" ? (
            parsed.other.length ? (
              <div>
                {parsed.other.map((o, i) => {
                  const eq = o.raw.indexOf("=");
                  const key = eq === -1 ? "(raw)" : o.raw.slice(0, eq);
                  const val = eq === -1 ? o.raw : o.raw.slice(eq + 1);

                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        gap: 8,
                        borderBottom: `1px solid ${COLORS.border}`,
                        padding: "8px 0",
                        alignItems: "flex-start",
                      }}
                    >
                      <span style={{ ...styles.mono, minWidth: 120, color: COLORS.muted }}>{key}</span>
                      <span style={styles.mono}>{val}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: COLORS.muted, fontSize: 13 }}>None</div>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
