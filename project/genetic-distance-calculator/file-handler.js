import * as XLSX from "xlsx";

export function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const tabCount = (headerLine.match(/\t/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

function parseDelimitedLine(line, delimiter) {
  const out = [];
  let curr = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        curr += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      out.push(curr);
      curr = "";
      continue;
    }
    curr += ch;
  }

  out.push(curr);
  return out;
}

export async function parseTabularFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const isExcel = /\.(xlsx|xls)$/i.test(name);

  if (isExcel) {
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { headers: [], rows: [] };
    const worksheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
    });
    if (!matrix.length) return { headers: [], rows: [] };

    const headers = (matrix[0] || []).map((v, idx) => {
      const text = String(v || "").trim();
      return text || `Column ${idx + 1}`;
    });

    const rows = matrix.slice(1).map((row) =>
      headers.reduce((acc, header, idx) => {
        acc[header] = String(row?.[idx] ?? "").trim();
        return acc;
      }, {}),
    );

    return { headers, rows };
  }

  const text = await file.text();
  const lines = String(text)
    .split(/\r?\n/)
    .filter((line) => String(line).trim().length > 0);

  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = parseDelimitedLine(lines[0], delimiter);
  const headers = rawHeaders.map((v, idx) => {
    const textVal = String(v || "").trim();
    return textVal || `Column ${idx + 1}`;
  });

  const rows = lines.slice(1).map((line) => {
    const cols = parseDelimitedLine(line, delimiter);
    return headers.reduce((acc, header, idx) => {
      acc[header] = String(cols?.[idx] ?? "").trim();
      return acc;
    }, {});
  });

  return { headers, rows };
}
