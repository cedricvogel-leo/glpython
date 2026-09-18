# glpython

A browser-based educational Python IDE with Microsoft 365 and OneDrive integration.

## Current preview

The first vertical slice includes:

- Monaco editor with lesson files
- Python execution in a Web Worker via Pyodide
- A browser graphics window with a `gturtle`-compatible starter API
- Output console and run/reset/save interactions
- Responsive classroom workspace layout
- Collapsible file sidebar and graphics side panel
- English/German UI localization, auto-detected from the browser language
- `input()` support via an on-page dialog, so interactive console programs work in the browser
- OneDrive connection state placeholder for the MSAL + Graph integration

## Run locally

```bash
npm install
npm run dev
```

The Pyodide runtime is loaded from jsDelivr when the browser worker starts, so the first run needs an internet connection.

## Turtle graphics

The worker includes a small browser-compatible `gturtle` module. For example:

```python
from gturtle import *

makeTurtle()
for _ in range(4):
  forward(100)
  right(90)
```

The drawing appears in the graphics window after running the project. The current API covers the core teaching operations: `makeTurtle`, `forward`, `backward`, `left`, `right`, `penUp`, `penDown`, `setPenColor`, and `setLineWidth`.

## Language

The interface language can be changed from the language menu in the header, which shows the currently active language and lists all available options in a dropdown. On first load, the language is auto-detected from the browser's language settings and then remembered per browser via local storage.

## Program input

Programs can call Python's built-in `input()` as usual. Because Python runs in a background Web Worker (so the page stays responsive even if a program has an infinite loop), `input()` pauses that worker and opens an on-page dialog asking for the requested value. Submitting the dialog resumes execution with the typed value; cancelling raises `EOFError`, just like closing stdin in a terminal.

This relies on `SharedArrayBuffer`, which browsers only allow on [cross-origin isolated](https://developer.chrome.com/blog/enabling-shared-array-buffer/) pages. The dev server and preview server send the required `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers automatically (see `vite.config.ts`). For static hosts that can't set custom response headers, `public/coi-serviceworker.js` (vendored from [gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker), MIT licensed) enables isolation via a Service Worker instead; it only activates if the page isn't already isolated, so it's safe to keep alongside the Vite headers.

## Local project files

The current project is also saved automatically in browser local storage. The header supports:

- **Open folder** in browsers with the File System Access API
- **Open ZIP** in all modern browsers with file upload support
- **Download ZIP** with all project files and `glpython.json` metadata

ZIP projects preserve relative paths, the project name, and the configured Python entry point. This local format is also the shape planned for OneDrive folder synchronization.

## Microsoft sign-in

Copy `.env.example` to `.env.local` and set the client ID from a Microsoft Entra ID single-page application registration:

```bash
cp .env.example .env.local
```

Register `http://localhost:5173` as a SPA redirect URI. Use `common` for accounts from multiple tenants, or set `VITE_ENTRA_TENANT_ID` to the school tenant ID. The current sign-in requests the delegated `User.Read` permission; Graph OneDrive permissions will be added next.

Sign-in/sign-out use MSAL's redirect flow (full-page navigation) rather than popups, since the strict `Cross-Origin-Opener-Policy` required for the `input()` dialog's `SharedArrayBuffer` bridge breaks popup-based auth.

## Next integration step

Add an Entra ID application registration, configure MSAL.js with the tenant client ID, and connect the save action to Microsoft Graph `drive/items` endpoints. SharePoint assignment workflows can then be layered on top of the same file model.
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
