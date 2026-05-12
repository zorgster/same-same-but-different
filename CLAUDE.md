# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the `project/` directory:

```bash
npm run dev       # Vite dev server
npm run build     # Production build (output: project/dist/)
npm run preview   # Preview production build
npm test          # Run Vitest test suite
```

To run a single test file:
```bash
npx vitest run tests/test-map-utils.test.js
```

## Architecture

**SSBD (SameSameButDifferent)** is a browser-only React SPA — a portal of specialized data validation and bioinformatics tools. All processing happens client-side; no server, no backend.

**Routing:** `main.jsx` mounts `BrowserRouter` → `menu-app-launcher.jsx` handles routing → individual tools load lazily. The tool registry lives in `apps-config.jsx`, which declares every tool's metadata and lazy-loaded component. Adding a new tool means registering it there.

**Tool pattern:** Each tool is either a single `.jsx` file or a self-contained folder (component + parsers + helpers + styles subfolder). Tools manage their own local state with React hooks — there is no global state management. Tools receive no props from the portal; they are fully autonomous.

**Data flow:** Files enter via `<input type="file">` or `react-dropzone` → parsed in-browser with `xlsx` (Excel), `papaparse` (CSV), `pdfjs-dist` (PDF), or custom parsers (VCF/FASTQ/TSV) → results rendered directly into local state.

**External APIs used:**
- Ensembl REST API — `fastq-gene-finder/` and `dna-sequence-visualizer/`
- Claude API — `pdf-table-extractor/` (OCR/table extraction from PDFs)

## Styling

All styles are inline CSS-in-JS — JavaScript objects defined at the top of each component file. There are no CSS files, no Tailwind, no CSS Modules.

**Central theme:** `styles/light-theme.js` is the single source of truth for colours and fonts. Import from there:
```js
import { COLORS, DNA_COLORS, RNA_COLORS, MONO_FONT, UI_FONT } from "../styles/light-theme";
```

- `COLORS` — UI palette (background, surface, border, accent teal, muted, error, success)
- `DNA_COLORS` — `{ A, T, C, G, N }` — IGV/Chromas convention: A=green, T=red, C=blue, G=amber
- `RNA_COLORS` — same but with `U` instead of `T`
- `MONO_FONT` — `"Courier New", Courier, monospace` — use for all sequence display, no Google Fonts
- `UI_FONT` — Segoe UI system stack

Do not define per-tool `COLORS` objects with different accent colours. Global portal styles live in `styles/menu-app-styles.jsx` (uses the same palette).

Dynamic style pattern:
```js
const zoneStyle = (active) => ({ border: `2px dashed ${active ? COLORS.accent : COLORS.border}` });
```

## Shared Widgets

**`widgets/DropZone.jsx`** — universal file drop zone, use this in all tools instead of inline dropzone implementations.

```jsx
import DropZone from "../widgets/DropZone";

<DropZone
  onFilesSelected={(files) => setFile(files[0])}
  accept={{ "text/csv": [".csv"], "application/vnd.ms-excel": [".xls", ".xlsx"] }}
  label="Drop a CSV or Excel file here, or click to select"
  multiple={false}
  selectedFiles={file ? [file] : []}
  fileInfo={[{ label: "Read Length", value: readLength }]}  // optional extra rows
/>
```

- `onFilesSelected(File[])` — parent receives raw `File` objects; parsing is the tool's responsibility
- `accept` — standard react-dropzone MIME map
- `multiple` — defaults to `false`
- `fileInfo` — optional `[{ label, value }]` rows shown below filename/size

## Tests

Framework: Vitest. Tests live in `project/tests/`, named `*.test.js`.

Current coverage is limited to pure utility functions (e.g., `map-utils.js` math for genetic distance calculation). Tests import actual data files from the tool's `data/` folder rather than fixtures.

## Key Dependencies

- `react-router-dom` v7 — routing
- `xlsx` — Excel parsing
- `papaparse` — CSV parsing
- `pdfjs-dist` — PDF text/table extraction
- `jszip`, `pako`, `fflate` — compression (used in VCF/FASTQ parsing)
- `lucide-react` — icons
- `react-dropzone` — file drop zones

No TypeScript. No ESLint config. No CSS framework.
