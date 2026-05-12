import { createWorker } from 'tesseract.js';

// Singleton worker — created on first use, reused across pages, never terminated
// unless the caller explicitly calls terminateOcrWorker().
let _worker   = null;
let _building = null;

// Mutable progress slot so a single logger closure can forward the current page's callback.
let _onProgress = null;

async function getWorker() {
  if (_worker)   return _worker;
  if (_building) return _building;

  _building = createWorker('eng', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') _onProgress?.(m.progress);
    },
  });
  _worker   = await _building;
  _building = null;
  return _worker;
}

export async function terminateOcrWorker() {
  if (_worker) { await _worker.terminate(); _worker = null; }
}

// ── Crop a rectangular region from a canvas ──────────────────────────────────
function extractCanvas(canvas, rect) {
  const W  = canvas.width;
  const H  = canvas.height;
  const bx = Math.round(rect.x1 * W);
  const by = Math.round(rect.y1 * H);
  const bw = Math.max(1, Math.round((rect.x2 - rect.x1) * W));
  const bh = Math.max(1, Math.round((rect.y2 - rect.y1) * H));
  const out = document.createElement('canvas');
  out.width = bw; out.height = bh;
  out.getContext('2d').drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh);
  return out;
}

// ── Collect all lines from a Tesseract Page result ───────────────────────────
function allLines(page) {
  const lines = [];
  for (const block of page.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        lines.push(line);
      }
    }
  }
  return lines;
}

// ── Assign a word (bbox in sub-canvas pixels) to a column index ──────────────
// colBounds: array of x-fractions [b0, b1, …, bN] where b0=0, bN=1 (sub-canvas)
function wordToCol(word, canvasW, colBounds) {
  const cx = (word.bbox.x0 + word.bbox.x1) / 2 / canvasW;
  for (let k = 0; k < colBounds.length - 1; k++) {
    if (cx < colBounds[k + 1]) return k;
  }
  return colBounds.length - 2;
}

// ── Build column boundaries in sub-canvas fraction space ─────────────────────
// dataRect is in full-page fractions; colMarkers likewise.
// Map them into [0, 1] relative to the sub-canvas x extent.
function buildColBounds(dataRect, colMarkers) {
  const w = dataRect.x2 - dataRect.x1;
  if (w <= 0) return [0, 1];
  const raw = [dataRect.x1, ...(colMarkers ?? []), dataRect.x2];
  return raw.map((x) => (x - dataRect.x1) / w);
}

// ── Measure ink density in a pixel rectangle of a canvas ────────────────────
// Skips a 2px inset on each side to ignore form border lines.
// Returns a value in [0, 1] where 1 = fully black.
function inkDensity(canvas, px, py, pw, ph) {
  const inset = 2;
  const x = Math.round(px) + inset;
  const y = Math.round(py) + inset;
  const w = Math.max(1, Math.round(pw) - inset * 2);
  const h = Math.max(1, Math.round(ph) - inset * 2);
  const { data } = canvas.getContext('2d').getImageData(x, y, w, h);
  let ink = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    if (lum < 180) ink++;
  }
  return ink / (w * h);
}

// ── OCR a single page ─────────────────────────────────────────────────────────
// canvas    — full baked page canvas
// pageDef   — { dataRect, metaRect, headerRect, colMarkers }
// colTypes  — string[] — "text" | "tick" per column (padded with "text" if short)
// onProgress— (0–1) called during recognition
//
// Returns:
//   { numCols, rows: string[][], headerRow: string[]|null, metaText: string|null }
export async function ocrPage(canvas, pageDef, colTypes = [], onProgress) {
  const { dataRect, metaRect, headerRect, colMarkers = [] } = pageDef;
  if (!dataRect) return null;

  const colBounds = buildColBounds(dataRect, colMarkers);
  const numCols   = colBounds.length - 1;

  // Normalise colTypes to numCols length, default "text"
  const types = Array.from({ length: numCols }, (_, k) => colTypes[k] ?? 'text');

  const worker = await getWorker();

  // ── Data rect ──────────────────────────────────────────────────────────────
  _onProgress = onProgress ?? null;
  const dataCanvas = extractCanvas(canvas, dataRect);
  const dataResult = await worker.recognize(dataCanvas, {}, { blocks: true });
  _onProgress = null;

  const lines = allLines(dataResult.data)
    .slice()
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const W = dataCanvas.width;

  const dataRows = lines.map((line) => {
    const cells = Array.from({ length: numCols }, () => '');

    for (let k = 0; k < numCols; k++) {
      if (types[k] === 'tick') {
        // Ink presence check — use the line's y extent as the cell bounds
        const cellX  = colBounds[k] * W;
        const cellW  = (colBounds[k + 1] - colBounds[k]) * W;
        const cellY  = line.bbox.y0;
        const cellH  = line.bbox.y1 - line.bbox.y0;
        cells[k] = inkDensity(dataCanvas, cellX, cellY, cellW, cellH) > 0.025 ? '✓' : '';
      }
    }

    // Assign OCR words for text columns
    for (const word of line.words ?? []) {
      const k = wordToCol(word, W, colBounds);
      if (types[k] !== 'tick') {
        cells[k] = cells[k] ? cells[k] + ' ' + word.text : word.text;
      }
    }

    return cells;
  });

  // ── Header rect ────────────────────────────────────────────────────────────
  let headerRow = null;
  if (headerRect) {
    const headerCanvas = extractCanvas(canvas, headerRect);
    const headerResult = await worker.recognize(headerCanvas, {}, { blocks: true });
    const hLines       = allLines(headerResult.data).sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const cells        = Array.from({ length: numCols }, () => '');
    for (const line of hLines) {
      for (const word of line.words ?? []) {
        const k = wordToCol(word, headerCanvas.width, colBounds);
        cells[k] = cells[k] ? cells[k] + ' ' + word.text : word.text;
      }
    }
    headerRow = cells;
  }

  // ── Meta rect ──────────────────────────────────────────────────────────────
  let metaText = null;
  if (metaRect) {
    const metaCanvas = extractCanvas(canvas, metaRect);
    const metaResult = await worker.recognize(metaCanvas, {}, { blocks: true });
    metaText = allLines(metaResult.data)
      .sort((a, b) => a.bbox.y0 - b.bbox.y0)
      .map((l) => l.text.trim())
      .filter(Boolean)
      .join(' ');
  }

  return { numCols, rows: dataRows, headerRow, metaText };
}
