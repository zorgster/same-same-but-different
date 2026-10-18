// Parses a questionnaire table (one row per person, one column per question)
// into { questions, people }. Works on a 2D array of cells so pasted text and
// uploaded spreadsheets share the same path.

export function splitPastedText(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => (l.includes("\t") ? l.split("\t") : l.split(/,|\s{2,}/)));
}

function toNumber(raw) {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseRows(rows) {
  const filtered = rows.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (filtered.length < 2) throw new Error("Paste at least a header row and one person's row.");

  const questions = filtered[0].slice(1).map((h) => String(h ?? "").trim());
  if (questions.length < 1) {
    throw new Error("Could not find question columns — the header row needs a name column plus one column per question.");
  }

  const people = [];
  filtered.slice(1).forEach((cells, i) => {
    if (cells.length < 2) return;
    const name = String(cells[0] ?? "").trim();
    people.push({
      name: name || `Row ${i + 1}`,
      values: questions.map((_, qi) => toNumber(cells[qi + 1])),
    });
  });
  if (people.length === 0) throw new Error("No data rows found under the header.");
  return { questions, people };
}

export function averageFor(people, qi) {
  let sum = 0, n = 0;
  for (const p of people) {
    if (p.values[qi] != null) { sum += p.values[qi]; n++; }
  }
  return n ? Math.round((sum / n) * 100) / 100 : null;
}
