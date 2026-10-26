# glpython

A browser-based educational Python IDE with Microsoft 365 and OneDrive integration.

This repository is the **shell application**: the classroom chrome (top bar,
files drawer, menu, auth, project persistence) that embeds the reusable
editor/visualizer/graphics core from
[glpython-editor](https://github.com/glpython-edu/glpython-editor) via the
`<GlPythonWorkspace>` component. The split exists so the editor, Python
execution, execution visualizer, and `gturtle` graphics panel can be embedded
in other contexts beyond this classroom shell.

- **glpython-editor** owns: the Monaco-based code editor, the Pyodide Web
  Worker and its `input()`/`gturtle` runtime, the step-by-step execution
  visualizer, and the turtle graphics canvas.
- **glpython** (this repo) owns: the overall page layout, the files drawer,
  language switching, Microsoft sign-in, and project persistence (local
  storage, ZIP/folder import-export, URL sharing).

## Layout

The IDE looks like the LiaScript embed, only larger:

- **One bar on top:** the logo, the workspace's own buttons in the embed's
  order and labels (**▶ Ausführen · Tests · Visualisieren**; ■ Stoppen in
  place of ▶ while Python is busy), and on the right **Teilen** and **⋮**
  (Python neu starten, open a folder or a ZIP project, download, language, and
  under development tools: delete the local project, with a confirmation).
  There is no Zurücksetzen in the bar: ▶ already starts with a fresh namespace
  and an empty console, ■ stops a hung program, and «Python neu starten» (a new
  Python and an empty console, as the embed's Reset; the code stays) is in ⋮.
- **Left edge:** **Dateien** (a drawer over the editor: the project name, its
  files, new, rename, delete) and **Python-Referenz**, labelled in their
  tooltips. Every file is also a tab above the editor.
- **Below:** the workspace in its stacked layout (editor on top, console
  below, a draggable divider; graphics beside the editor only while a program
  draws; the visualizer in place of the editor). See glpython-editor's README.
- The runtime's status shows only while it loads or failed; no footer.

## Run locally

```bash
npm install
npm run dev
```

The Pyodide runtime is loaded from jsDelivr when the browser worker starts, so
the first run needs an internet connection.

## Using a local glpython-editor checkout

By default, `glpython-editor` is installed straight from its GitHub repo (see
the `glpython-editor` entry in `package.json`). To develop both repos
together, point npm at a local checkout instead:

```bash
npm install ../glpython-editor
```

Remember to revert `package.json` back to the `github:` reference before
committing, and run `npm install` again to restore the published dependency.

## Language

The interface language can be changed in the ⋮ menu, which marks the active
language. On first load, the language is auto-detected from the browser's
language settings and then remembered per browser via local storage.

## Project persistence

The current project is saved automatically in browser local storage. The
⋮ menu and the bar support:

- **Ordner öffnen** in browsers with the File System Access API
- **Projekt öffnen** (a ZIP) in all modern browsers with file upload support
- **Projekt herunterladen** as a ZIP with all project files and `glpython.json`
  metadata
- **Teilen**, which serializes the entire project structure (files, contents,
  and metadata) into a compressed link (`?project=`, or `#project=` beyond
  GitHub Pages' URL limit) so a project can be shared or reopened without a
  server, similar to
  [webtigerpython.ethz.ch](https://webtigerpython.ethz.ch/)

ZIP projects preserve relative paths, the project name, and the configured
Python entry point. This local format is also the shape planned for OneDrive
folder synchronization.

## Microsoft sign-in

Copy `.env.example` to `.env.local` and set the client ID from a Microsoft
Entra ID single-page application registration:

```bash
cp .env.example .env.local
```

Register `http://localhost:5173` as a SPA redirect URI. Use `common` for
accounts from multiple tenants, or set `VITE_ENTRA_TENANT_ID` to the school
tenant ID. The current sign-in requests the delegated `User.Read` permission;
Graph OneDrive permissions will be added next.

Sign-in/sign-out use MSAL's redirect flow (full-page navigation) rather than
popups, since the strict `Cross-Origin-Opener-Policy` required for the
`input()` dialog's `SharedArrayBuffer` bridge (owned by `glpython-editor`)
breaks popup-based auth.

## Cross-origin isolation

`glpython-editor`'s `input()` dialog relies on `SharedArrayBuffer`, which
browsers only allow on
[cross-origin isolated](https://developer.chrome.com/blog/enabling-shared-array-buffer/)
pages. The dev server and preview server send the required
`Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers
automatically (see `vite.config.ts`). For static hosts that can't set custom
response headers (such as GitHub Pages), `public/coi-serviceworker.js`
(vendored from [gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker),
MIT licensed) enables isolation via a Service Worker instead; it only
activates if the page isn't already isolated, so it's safe to keep alongside
the Vite headers.

## Deployment

Every push to `main` publishes the app to GitHub Pages at the organization's
root, <https://glpython-edu.github.io/> (the repo is named
`glpython-edu.github.io`). `npm run build && npm run preview` serves the same
layout locally. The embed for LiaScript courses lives next to it, at
<https://glpython-edu.github.io/glpython-editor/>, deployed from
glpython-editor.

## Next integration step

Add an Entra ID application registration, configure MSAL.js with the tenant
client ID, and connect the save action to Microsoft Graph `drive/items`
endpoints. SharePoint assignment workflows can then be layered on top of the
same file model.

## Lizenz / License

MIT – see [LICENSE](LICENSE). The libraries the build bundles (React, Monaco's
React wrapper, lucide, MSAL, JSZip, lz-string, glpython-editor) and the vendored
coi-serviceworker are listed with their notices in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
