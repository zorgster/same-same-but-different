# SameSameButDifferent (SSBD)

Browser-based data validation tools for comparing and reconciling spreadsheet exports.

## What this project does

- Compare columns of data across files
- Detect missing and additional records
- Flag changed values (for example, same ID with different name)
- Provide a portal pattern for adding future validation tools

## Current tool

- Column Compare: compare two spreadsheet uploads and highlight missing, added, and changed values

## Project structure

- `project/` - Vite + React application
- `.gitignore` - Git ignore rules for Node and React artifacts

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
