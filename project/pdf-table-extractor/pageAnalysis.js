// ── Bake a page with rotation applied → returns an HTMLCanvasElement ─────────
export function bakePage(dataUrl, w, h, rot) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const rad = (rot * Math.PI) / 180;
      const cos = Math.abs(Math.cos(rad));
      const sin = Math.abs(Math.sin(rad));
      const bw  = Math.round(w * cos + h * sin);
      const bh  = Math.round(w * sin + h * cos);
      const c   = document.createElement("canvas");
      c.width = bw; c.height = bh;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, bw, bh);
      ctx.save();
      ctx.translate(bw / 2, bh / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      resolve(c);
    };
    img.src = dataUrl;
  });
}

// ── Detect the main data rectangle. ─────────────────────────────────────────
// Two-pass approach:
//   Y-pass: full-page row density → centroid → outward scan.
//   X-pass: column density computed ONLY within the detected Y band, then a
//           right-to-left scan that records the leftmost / rightmost position
//           above an adaptive ink threshold.
// Computing column density within the Y band means a 2-row page is not diluted
// across the full page height, and a left margin element (page number etc.) that
// sits outside the band doesn't corrupt the X detection.
// The R→L scan replaces the previous "largest contiguous run" approach so the
// leftmost column is found even when it is separated from the rest by a gap
// wider than the bridge tolerance.
// x2 scan is capped at x2Frac (default 0.88) to exclude right-edge signature
// columns before density analysis.
export function detectDataRect(canvas, x2Frac = 0.88) {
  // Downscale to ≤300 px wide — enough resolution for profile detection, faster
  const SCALE = Math.min(1, 300 / canvas.width);
  const W     = Math.round(canvas.width  * SCALE);
  const H     = Math.round(canvas.height * SCALE);
  const small = document.createElement("canvas");
  small.width = W; small.height = H;
  small.getContext("2d").drawImage(canvas, 0, 0, W, H);
  const { data } = small.getContext("2d").getImageData(0, 0, W, H);

  const ink = (p) => 255 - (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);

  // ── Y-pass: per-row ink density over full width ──────────────────────────
  const rowDensity = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) s += ink((y * W + x) * 4);
    rowDensity[y] = s / (W * 255);
  }

  // 5 % window bridges blank rows within the table; also suppresses thin rule
  // lines — a 1-2 px border is diluted across the window.
  const smoothRow = _smooth(rowDensity, H, Math.max(3, Math.round(H * 0.05)));

  // Density-weighted centroid → start point immune to thin rule lines at edges
  let rowMass = 0, rowWt = 0;
  for (let y = 0; y < H; y++) { rowMass += smoothRow[y]; rowWt += y * smoothRow[y]; }
  const centreRow = rowMass > 0 ? Math.round(rowWt / rowMass) : Math.round(H / 2);
  const [y1, y2] = _outwardScan(smoothRow, H, centreRow, 0.004);

  if (y1 < 0) return null;

  // ── X-pass: column density within [y1, y2] only ─────────────────────────
  // Measuring within the band prevents full-page dilution on sparse pages and
  // excludes margin elements (headers, footers, page numbers) that sit outside.
  const px2   = Math.round(x2Frac * W);
  const bandH = Math.max(1, y2 - y1);
  const colDensity = new Float32Array(px2);
  for (let x = 0; x < px2; x++) {
    let s = 0;
    for (let y = y1; y <= y2; y++) s += ink((y * W + x) * 4);
    colDensity[x] = s / (bandH * 255);
  }

  // 8 % window bridges inter-column white gaps (wider than row gaps)
  const smoothCol = _smooth(colDensity, px2, Math.max(3, Math.round(W * 0.08)));

  // Adaptive threshold: 12 % of the peak column density in the band.
  // Scales automatically with document ink weight; min floor of 0.005.
  const peakCol  = smoothCol.reduce((m, v) => v > m ? v : m, 0);
  const colThresh = Math.max(0.005, peakCol * 0.12);

  // R→L scan: rightmost dense position → x2, leftmost → x1.
  // Scanning right-to-left naturally gives x2 on the first hit and accumulates
  // x1 as we move left, so all columns (including widely-separated first column)
  // are included as long as they exceed the threshold.
  const [x1, x2] = _xBounds(smoothCol, px2, colThresh);

  if (x1 < 0) return null;

  const margin  = Math.round(H * 0.004);
  const xMargin = Math.round(W * 0.003);
  return {
    x1: Math.max(0, (x1 - xMargin) / W),
    y1: Math.max(0, (y1 - margin)  / H),
    x2: Math.min(1, (x2 + xMargin) / W),
    y2: Math.min(1, (y2 + margin)  / H),
  };
}

// Scan right-to-left: first hit above inkThresh → x2 (rightmost),
// last hit (kept updated) → x1 (leftmost). No contiguity required.
function _xBounds(smoothed, n, inkThresh) {
  let x1 = -1, x2 = -1;
  for (let x = n - 1; x >= 0; x--) {
    if (smoothed[x] > inkThresh) {
      if (x2 < 0) x2 = x;
      x1 = x;
    }
  }
  return [x1, x2];
}

// Box-filter smooth — simple O(n·w) but n is at most ~1500 and w ~60.
function _smooth(arr, n, w) {
  const out  = new Float32Array(n);
  const half = Math.floor(w / 2);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += arr[j];
    out[i] = s / (hi - lo + 1);
  }
  return out;
}

// Start at `centre`, walk left until density < inkThresh (→ x1/y1),
// walk right until density < inkThresh (→ x2/y2).
// Returns [-1,-1] if centre is already below threshold (no table at centre).
function _outwardScan(smoothed, n, centre, inkThresh) {
  if (smoothed[centre] < inkThresh) return [-1, -1];

  let lo = centre;
  while (lo > 0       && smoothed[lo - 1] >= inkThresh) lo--;

  let hi = centre;
  while (hi < n - 1   && smoothed[hi + 1] >= inkThresh) hi++;

  // Must span at least 2% of the dimension (handles pages with only 1–2 rows)
  if (hi - lo < n * 0.02) return [-1, -1];

  return [lo, hi];
}

// ── Snap each column marker to the left edge of the next column's ink. ────────
// Uses the marker's local position to decide which way to scan:
//   • marker is in the gap  → scan RIGHT to find where the next column starts
//   • marker is inside ink  → scan LEFT  to find where that column started
// Idempotent: once at the left edge of the column the marker no longer moves.
export function shimmyMarkers(canvas, colMarkers, tol = 0.025) {
  const W    = canvas.width;
  const H    = canvas.height;
  const data = canvas.getContext("2d").getImageData(0, 0, W, H).data;

  const colSums = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) {
      const p = (y * W + x) * 4;
      s += 255 - (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
    }
    colSums[x] = s;
  }

  return colMarkers.map(mx => {
    const sx1  = Math.max(0,     Math.round((mx - tol) * W));
    const sx2  = Math.min(W - 1, Math.round((mx + tol) * W));
    const mxPx = Math.round(mx * W);

    // Adaptive threshold: needs gap (low) and column (high) both visible in window
    let minSum = Infinity, maxSum = 0;
    for (let x = sx1; x <= sx2; x++) {
      if (colSums[x] < minSum) minSum = colSums[x];
      if (colSums[x] > maxSum) maxSum = colSums[x];
    }

    // If there's no meaningful gap/column contrast in the window, leave unchanged.
    // This covers: marker already deep inside a column (gap is outside ±tol).
    if (maxSum < H * 3 || minSum > maxSum * 0.3) return mx;

    // 25 % of the way from gap-floor to column-ceiling
    const inkThreshold = minSum + (maxSum - minSum) * 0.25;

    // Find inkStart: the leftmost inky pixel of the right column.
    // • If marker is in ink  → scan left until the column's left edge.
    // • If marker is in gap  → scan right until the next column begins.
    let inkStart = -1;
    if (colSums[mxPx] > inkThreshold) {
      let e = mxPx;
      while (e > sx1 && colSums[e - 1] > inkThreshold) e--;
      if (e > sx1) inkStart = e;
    } else {
      let e = mxPx;
      while (e <= sx2 && colSums[e] <= inkThreshold) e++;
      if (e <= sx2) inkStart = e;
    }
    if (inkStart < 0) return mx;

    // The gap spans [gapLeftPx … inkStart-1].  Place the marker at the centre
    // so there is equal white space on both sides (padding ≥ half the gap width).
    const gapRightPx = inkStart - 1;
    let gapLeftPx = gapRightPx;
    while (gapLeftPx > sx1 && colSums[gapLeftPx - 1] <= inkThreshold) gapLeftPx--;
    const centre = Math.round((gapLeftPx + gapRightPx) / 2);
    return Math.max(sx1, Math.min(sx2, centre)) / W;
  });
}

// ── Move a rect up to the ink band immediately above its current position. ────
// Scans up from rect.y1, skips blank space, then finds the full extent of the
// ink band above. Returns a new rect positioned there, or null if nothing above.
export function shimmyRectUp(canvas, rect) {
  const W    = canvas.width;
  const H    = canvas.height;
  const px1  = Math.round(rect.x1 * W);
  const px2  = Math.round(rect.x2 * W);
  const colW = Math.max(1, px2 - px1);
  const { data } = canvas.getContext("2d").getImageData(px1, 0, colW, H);

  const rowSum = y => {
    if (y < 0 || y >= H) return 0;
    let s = 0;
    for (let x = 0; x < colW; x++) {
      const p = (y * colW + x) * 4;
      s += 255 - (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
    }
    return s;
  };

  const threshold = colW * 1.5;
  const margin    = Math.round(H * 0.005);

  let y = Math.round(rect.y1 * H) - 1;

  // Skip blank space above the current rect
  while (y >= 0 && rowSum(y) < threshold) y--;
  if (y < 0) return null;

  // Found bottom of the ink band above — scan up to find its top
  const inkBottom = y;
  while (y > 0 && rowSum(y - 1) >= threshold) y--;
  const inkTop = y;

  return {
    ...rect,
    y1: Math.max(0, (inkTop - margin) / H),
    y2: Math.min(1, (inkBottom + margin) / H),
  };
}

// ── Shimmy data-rect edges to the actual ink extent — bidirectional. ─────────
// Top: if y1 is in blank space scan down to first inky row; if y1 is already
//      in data scan up to the blank gap above it.
// Bottom: if y2 is in blank space scan up to last inky row; if y2 is already
//         in data scan down to the blank gap below it.
// stopRects (metaRect / headerRect) act as hard ceilings for the top edge. ───
export function shimmyDataRect(canvas, dataRect, stopRects = []) {
  const W     = canvas.width;
  const H     = canvas.height;
  const px1   = Math.round(dataRect.x1 * W);
  const px2   = Math.round(dataRect.x2 * W);
  const colW  = Math.max(1, px2 - px1);
  const { data } = canvas.getContext("2d").getImageData(px1, 0, colW, H);

  const rowSum = y => {
    if (y < 0 || y >= H) return 0;
    let s = 0;
    for (let x = 0; x < colW; x++) {
      const p = (y * colW + x) * 4;
      s += 255 - (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
    }
    return s;
  };

  const threshold = colW * 1.5;
  const margin    = Math.round(H * 0.005);

  // Hard ceiling for the top edge: bottom of any stop rect
  const stopY  = stopRects.filter(Boolean).reduce((m, r) => Math.max(m, r.y2), 0);
  const stopPx = Math.round(stopY * H);

  let y1 = Math.round(dataRect.y1 * H);
  let y2 = Math.round(dataRect.y2 * H);

  // ── Top edge ──────────────────────────────────────────────────────────────
  if (rowSum(y1) < threshold) {
    // y1 is in blank space — scan down to first inky row
    while (y1 < y2 && rowSum(y1) < threshold) y1++;
  } else {
    // y1 is inside data — scan up to the blank gap above the first data row
    while (y1 > Math.max(stopPx, 1)) {
      if (rowSum(y1 - 1) < threshold) break;
      y1--;
    }
  }

  // ── Bottom edge ───────────────────────────────────────────────────────────
  if (rowSum(y2) < threshold) {
    // y2 is in blank space — scan up to last inky row
    while (y2 > y1 && rowSum(y2) < threshold) y2--;
  } else {
    // y2 is inside data — scan down to the blank gap below the last data row
    while (y2 < H - 1) {
      if (rowSum(y2 + 1) < threshold) break;
      y2++;
    }
  }

  // ── X edge adjustment within the adjusted Y band ─────────────────────────
  // Column sums computed only within [y1,y2] so sparse pages aren't diluted
  // and margin elements outside the band don't corrupt detection.
  const py1 = Math.max(0,     y1);
  const py2 = Math.min(H - 1, y2);
  const bH  = Math.max(1, py2 - py1 + 1);

  // Wider strip: left margin to snap x1 inward, right margin to catch overhangs
  const xScanL = Math.round(W * 0.06);
  const xScanR = Math.round(W * 0.06);
  const rx1 = Math.max(0,     px1 - xScanL);
  const rx2 = Math.min(W - 1, px2 + xScanR);
  const rW  = rx2 - rx1 + 1;

  const { data: xd } = canvas.getContext("2d").getImageData(rx1, py1, rW, bH);
  const colSums = new Float32Array(rW);
  for (let lx = 0; lx < rW; lx++) {
    let s = 0;
    for (let row = 0; row < bH; row++) {
      const p = (row * rW + lx) * 4;
      s += 255 - (xd[p] * 0.299 + xd[p + 1] * 0.587 + xd[p + 2] * 0.114);
    }
    colSums[lx] = s;
  }
  const cs = (absX) => { const lx = absX - rx1; return (lx >= 0 && lx < rW) ? colSums[lx] : 0; };
  const xThresh    = bH * 1.5;
  const xMarginPx  = Math.round(W * 0.003);

  // x1: bidirectional snap to left edge of first column's ink
  let nx1 = px1;
  if (cs(nx1) < xThresh) {
    while (nx1 < px2 && cs(nx1) < xThresh) nx1++;
  } else {
    while (nx1 > rx1 && cs(nx1 - 1) >= xThresh) nx1--;
  }

  // x2: scan rightward — rightmost inky column within scan range becomes new x2,
  // catching signature marks / tick overhangs beyond the auto-detected boundary.
  let nx2 = px2;
  for (let x = px2; x <= rx2; x++) {
    if (cs(x) >= xThresh) nx2 = x;
  }

  return {
    ...dataRect,
    x1: Math.max(0, (nx1 - xMarginPx) / W),
    y1: Math.max(stopY, (y1 - margin)  / H),
    x2: Math.min(1, (nx2 + xMarginPx) / W),
    y2: Math.min(1, (y2  + margin)     / H),
  };
}

// ── Detect the ink band at a given Y fraction within a rect's X bounds. ─────
// Used for click-to-set-metadata-row: user clicks anywhere on a row and this
// finds the top/bottom of that single row.
// Uses the clicked row's own density as the reference: scanning stops when
// density drops to < 50% of the reference.  This catches both dashed/thin
// border lines (typically ~50% of text-row density) and plain white gaps,
// without the fixed low threshold that would walk through the whole table.
// A safety cap (25% of data-block height) prevents runaway if thresholds are
// marginal.
export function detectRowAtY(canvas, rect, yFrac) {
  const W    = canvas.width;
  const H    = canvas.height;
  const px1  = Math.round(rect.x1 * W);
  const px2  = Math.round(rect.x2 * W);
  const colW = Math.max(1, px2 - px1);
  const { data } = canvas.getContext("2d").getImageData(px1, 0, colW, H);

  const rowSum = y => {
    if (y < 0 || y >= H) return 0;
    let s = 0;
    for (let x = 0; x < colW; x++) {
      const p = (y * colW + x) * 4;
      s += 255 - (data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114);
    }
    return s;
  };

  const presenceThresh = colW * 1.5;
  let y = Math.round(yFrac * H);

  // If click landed in blank space, snap to nearest inky row
  if (rowSum(y) < presenceThresh) {
    let up = y - 1, dn = y + 1;
    while (up >= 0 && rowSum(up) < presenceThresh) up--;
    while (dn < H  && rowSum(dn) < presenceThresh) dn++;
    if (up < 0 && dn >= H) return null;
    y = (up >= 0 && (dn >= H || y - up <= dn - y)) ? up : dn;
    if (rowSum(y) < presenceThresh) return null;
  }

  // Row-boundary threshold: 50% of the clicked row's density.
  // Dashed/thin borders between rows are typically ~50% of a text row's density,
  // so this stops at them without a fixed absolute value.
  const rowThresh = Math.max(presenceThresh, rowSum(y) * 0.5);

  // Safety cap: no single row should exceed 25% of the data block height
  const maxHalf = Math.round(Math.max(H * 0.04, (rect.y2 - rect.y1) * H * 0.25));

  let top = y;
  while (top > Math.max(0, y - maxHalf)) {
    if (rowSum(top - 1) < rowThresh) break;
    top--;
  }

  let bottom = y;
  while (bottom < Math.min(H - 1, y + maxHalf)) {
    if (rowSum(bottom + 1) < rowThresh) break;
    bottom++;
  }

  const margin = Math.round(H * 0.003);
  return {
    x1: rect.x1,
    y1: Math.max(0, (top    - margin) / H),
    x2: rect.x2,
    y2: Math.min(1, (bottom + margin) / H),
  };
}
