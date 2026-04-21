import { formatPackageLabel, formatToolLabel, resolveHistoryFamily } from "./history-tool-labels.jsx";

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

function normalizeCommandValue(rawVal) {
  let value = String(rawVal || "").trim();
  if (!value) return value;

  const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : null;
  if (quote && value.endsWith(quote) && value.indexOf(quote, 1) === value.length - 1) {
    value = value.slice(1, -1).trim();
  }

  return value;
}

function splitTrailingDate(text) {
  const value = String(text || "").trim();
  const match = value.match(/^(.*?)(?:;\s*Date\s*=\s*(.+))$/i);
  if (!match) return { text: value, date: null };

  return {
    text: match[1].trim(),
    date: match[2].trim() || null,
  };
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

    if (sub) return formatToolLabel("bcftools", sub);

    if (keyLower.includes("command")) {
      const firstToken = val.split(/\s+/)[0] || "";
      if (firstToken && firstToken.toLowerCase() !== "bcftools") {
        return formatToolLabel("bcftools", firstToken);
      }
    }

    return formatPackageLabel("bcftools");
  }

  if (keyLower.startsWith("gatkcommandline")) {
    if (id) return formatToolLabel("gatk", id);
    const suffix = key.includes(".") ? key.slice(key.indexOf(".") + 1).trim() : "";
    return suffix ? formatToolLabel("gatk", suffix) : formatPackageLabel("gatk");
  }

  if (keyLower.endsWith("version")) {
    const base = key.replace(/Version$/i, "").replace(/[_-]+$/g, "").trim();
    if (base) return formatPackageLabel(base);
  }

  if (keyLower.includes("freebayes") || valLower.includes("freebayes")) return formatPackageLabel("freebayes");
  if (keyLower.includes("picard")) return formatPackageLabel("picard");
  if (keyLower.includes("samtools")) return formatPackageLabel("samtools");
  if (keyLower.startsWith("vep")) return formatPackageLabel("vep");
  if (keyLower.includes("snpeff")) return formatPackageLabel("snpeff");
  if (keyLower.includes("snpsift")) return formatPackageLabel("snpsift");

  return formatPackageLabel(key.replace(/[_]?Command(?:Line)?$/i, "").replace(/[_-]+$/g, "").trim()) || key;
}

function parseVepMetadata(rawValue) {
  const tokens = tokenizeCommandText(rawValue);
  if (!tokens.length) return { version: null, options: [] };

  const options = [];
  let version = null;
  let startIndex = 0;

  if (!tokens[0].includes("=")) {
    version = String(tokens[0] || "").trim() || null;
    if (version) options.push({ key: "Version", value: version, source: "structured" });
    startIndex = 1;
  }

  for (let i = startIndex; i < tokens.length; i += 1) {
    const pair = splitKeyValueToken(tokens[i]);
    if (!pair) continue;
    options.push({ ...pair, source: "structured" });
  }

  return { version, options };
}

function getMergeSignature(keyLower) {
  if (keyLower === "vep") return { base: "vep", kind: "vep-meta" };
  if (keyLower.startsWith("vep-command-line")) return { base: "vep", kind: "vep-command" };

  if (/version$/i.test(keyLower)) {
    return { base: keyLower.replace(/version$/i, ""), kind: "version" };
  }

  if (/(command|commandline|cmd)$/i.test(keyLower)) {
    return { base: keyLower.replace(/(command|commandline|cmd)$/i, ""), kind: "command" };
  }

  return { base: null, kind: "single" };
}

function parseHistoryEntry(key, rawVal) {
  const keyLower = String(key || "").toLowerCase();
  const mergeSignature = getMergeSignature(keyLower);
  const normalizedVal = normalizeCommandValue(rawVal);
  const withTrailingDate = splitTrailingDate(normalizedVal);
  const structured = normalizedVal.startsWith("<") && normalizedVal.endsWith(">") ? parseStructuredField(normalizedVal) : null;
  const vepMetadata = keyLower === "vep" ? parseVepMetadata(normalizedVal) : null;

  const family = resolveHistoryFamily(key, normalizedVal);
  const tool = resolveHistoryToolLabel(key, normalizedVal, structured);
  const plainVersion = /version$/i.test(keyLower) ? normalizeCommandValue(rawVal) : null;
  const version = structured?.Version || vepMetadata?.version || plainVersion || null;
  const date = structured?.Date || withTrailingDate.date || null;
  const epoch = structured?.Epoch || null;
  const commandLine = structured?.CommandLine || null;
  const commandLineOptions = structured?.CommandLineOptions || null;
  const commandText = commandLine || commandLineOptions || withTrailingDate.text;
  const isVersionHeader = /version$/i.test(keyLower);
  const command = isVersionHeader || keyLower === "vep"
    ? null
    : commandText && !commandText.startsWith("<")
      ? commandText
      : normalizedVal;

  const options = commandLineOptions
    ? parseOptionTokens(commandLineOptions)
    : keyLower === "vep"
      ? (vepMetadata?.options || [])
      : parseDashedCommandOptions(commandLine || withTrailingDate.text);

  const structuredExtras = structured
    ? Object.entries(structured)
        .filter(([field]) => !["ID", "Version", "Date", "Epoch", "CommandLine", "CommandLineOptions"].includes(field))
        .map(([field, value]) => ({ field, value }))
    : [];

  return {
    key,
    keyLower,
    tool,
    family,
    id: structured?.ID || null,
    version,
    date,
    epoch,
    command: typeof command === "string" ? command.trim() : "",
    commandLine,
    commandLineOptions,
    options,
    structuredExtras,
    raw: normalizedVal,
    mergeBase: mergeSignature.base,
    mergeKind: mergeSignature.kind,
  };
}

function canMerge(existing, incoming) {
  if (!existing.mergeBase || !incoming.mergeBase) return false;
  if (existing.mergeBase !== incoming.mergeBase) return false;

  const a = existing.mergeKind;
  const b = incoming.mergeKind;

  const isVepPair = (a === "vep-meta" && b === "vep-command") || (a === "vep-command" && b === "vep-meta");
  const isVersionCommandPair = (a === "version" && b === "command") || (a === "command" && b === "version");

  return isVepPair || isVersionCommandPair;
}

function mergeHistoryEntries(entries) {
  const merged = [];

  const isGenericBcftoolsLabel = (label) => String(label || "") === formatPackageLabel("bcftools");

  for (const entry of entries) {
    const existingIndex = merged.findIndex((candidate) => canMerge(candidate, entry));

    if (existingIndex === -1) {
      merged.push(entry);
      continue;
    }

    const existing = merged[existingIndex];
    const preferEntryHeaderKey =
      /command(?:line)?/.test(String(entry.keyLower || "")) && /version$/.test(String(existing.keyLower || ""));
    const mergedTool = isGenericBcftoolsLabel(existing.tool) && !isGenericBcftoolsLabel(entry.tool)
      ? entry.tool
      : existing.tool || entry.tool;

    merged[existingIndex] = {
      ...existing,
      key: preferEntryHeaderKey ? entry.key : existing.key,
      keyLower: preferEntryHeaderKey ? entry.keyLower : existing.keyLower,
      tool: mergedTool,
      family: existing.family || entry.family,
      id: existing.id || entry.id,
      version: existing.version || entry.version,
      date: existing.date || entry.date,
      epoch: existing.epoch || entry.epoch,
      command: existing.command || entry.command,
      commandLine: existing.commandLine || entry.commandLine,
      commandLineOptions: existing.commandLineOptions || entry.commandLineOptions,
      options: existing.options.length ? existing.options : entry.options,
      structuredExtras: existing.structuredExtras.length ? existing.structuredExtras : entry.structuredExtras,
      raw: existing.raw || entry.raw,
      mergeBase: existing.mergeBase || entry.mergeBase,
      mergeKind: existing.mergeKind,
    };
  }

  return merged;
}

function extractHistoryFromKeyValueEntries(entries) {
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
  const toolHintRegex = /(gatk|bcftools|mutect|freebayes|picard|samtools|vep|snpeff|snpsift|genotypegvcfs|combinevariants|haplotypecaller)/i;

  for (const pair of entries || []) {
    const key = String(pair?.key || "").trim();
    const rawVal = String(pair?.value || "");
    if (!key) continue;

    const keyLower = key.toLowerCase();
    const valLower = rawVal.toLowerCase();
    const looksStructuredSchemaValue = rawVal.trim().startsWith("<") && rawVal.includes("ID=");

    if (nonHistorySchemaKeys.has(keyLower) && looksStructuredSchemaValue) continue;

    const hasCommandKey = /(command|commandline|commandlineoptions|cmd)/i.test(keyLower);
    const hasKnownToolSignal = toolHintRegex.test(`${keyLower} ${valLower}`);
    const hasVersionKey = /version$/i.test(keyLower) && hasKnownToolSignal;
    const hasGatkCommandKey = keyLower.startsWith("gatkcommandline");
    const hasFreeBayesSignal = keyLower.includes("freebayes") || valLower.includes("freebayes");
    const hasVepSignal = keyLower === "vep" || keyLower.startsWith("vep-") || valLower.includes("vep");
    const hasBcftoolsHeader = keyLower.startsWith("bcftools_");
    const sourceCarriesFreeBayes = keyLower === "source" && hasFreeBayesSignal;

    if (!hasCommandKey && !hasVersionKey && !hasFreeBayesSignal && !sourceCarriesFreeBayes && !hasGatkCommandKey && !hasVepSignal && !hasBcftoolsHeader) {
      continue;
    }

    const entry = parseHistoryEntry(key, rawVal);
    if (!entry.command && !entry.version && !entry.commandLine && !entry.commandLineOptions) continue;
    history.push(entry);
  }

  return mergeHistoryEntries(history);
}

export function extractHistoryFromHeaderLines(lines) {
  const entries = [];

  for (const line of lines || []) {
    if (!String(line || "").startsWith("##")) continue;
    const rest = line.slice(2);
    const eqIdx = rest.indexOf("=");
    if (eqIdx === -1) continue;

    entries.push({
      key: rest.slice(0, eqIdx),
      value: rest.slice(eqIdx + 1),
    });
  }

  return extractHistoryFromKeyValueEntries(entries);
}

export function extractHistoryFromOtherEntries(otherEntries) {
  const entries = [];

  for (const entry of otherEntries || []) {
    const key = String(entry?.key || "").trim();
    if (!key) continue;

    entries.push({
      key,
      value: String(entry?.value || ""),
    });
  }

  return extractHistoryFromKeyValueEntries(entries);
}
