# SameSameButDifferent (SSBD)

Browser-based data validation tools for comparing and reconciling spreadsheet exports.

## What this project does

- Compare data across files
- Detect missing and additional records
- Flag changed values (for example, same ID with different name)
- Provide a portal pattern for adding future validation tools

## Current tool

- Name-ID Mismatch Checker: compare Names and IDs in two spreadsheet uploads and highlight missing, added, and changed values

## Project structure

- `project/` - Vite + React application
- `project/apps-config.jsx` - Portal tool registry and metadata
- `.gitignore` - Git ignore rules for Node and React artifacts

## Adding a new tool

1. Create a new tool component file in `project/` (for example `new-validator.jsx`).
2. Import it in `project/apps-config.jsx`.
3. Add an item inside a section's `apps` array with `component: YourComponent` for live tools, or `component: null` for coming-soon tools.

## Grouping tools into sections

- `APPS` is section-based: each section has `id`, `title`, and `apps`.
- Example sections include Tool Portal and Genomics Tools.
- Add new domain collections by adding another section object in `project/apps-config.jsx`.

## Local development

From the repository root:

1. `cd project`
2. `npm install`
3. `npm run dev`

## Production build

From `project/`:

1. `npm run build`
2. Output is generated in `project/dist`

## Netlify deployment

Use these settings in Netlify when this repository is connected:

- Base directory: `project`
- Build command: `npm run build`
- Publish directory: `dist`

## License

ISC
