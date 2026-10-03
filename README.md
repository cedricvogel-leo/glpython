# glpython

A browser-based educational Python IDE with Microsoft 365 and OneDrive integration.

This repository is the **shell application**: the classroom chrome (header, file
sidebar, lesson header, auth, project persistence) that embeds the reusable
editor/visualizer/graphics core from
[glpython-editor](https://github.com/cedricvogel-leo/glpython-editor) via the
`<GlPythonWorkspace>` component. The split exists so the editor, Python
execution, execution visualizer, and `gturtle` graphics panel can be embedded
in other contexts beyond this classroom shell.

- **glpython-editor** owns: the Monaco-based code editor, the Pyodide Web
  Worker and its `input()`/`gturtle` runtime, the step-by-step execution
  visualizer, and the turtle graphics canvas.
- **glpython** (this repo) owns: the overall page layout, the file
  sidebar and lesson metadata, language switching, Microsoft sign-in, and
  project persistence (local storage, ZIP/folder import-export, URL sharing).

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

The interface language can be changed from the language menu in the header,
which shows the currently active language and lists all available options in
a dropdown. On first load, the language is auto-detected from the browser's
language settings and then remembered per browser via local storage.

## Project persistence

The current project is saved automatically in browser local storage. The
header supports:

- **Open folder** in browsers with the File System Access API
- **Open ZIP** in all modern browsers with file upload support
- **Download ZIP** with all project files and `glpython.json` metadata
- **Share project**, which serializes the entire project structure (files,
  contents, and metadata) into a compressed URL fragment so a project can be
  shared or reopened without a server, similar to
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

This app is published to GitHub Pages at the `/glpython/` sub-path (see the
`base` option in `vite.config.ts`). Because `vite preview` doesn't serve the
build under that sub-path by default, locally previewing the exact production
layout requires serving `dist/` from a path ending in `/glpython/` (for
example via a symlink into a static file server), rather than running
`npm run preview` directly at the site root.

## Next integration step

Add an Entra ID application registration, configure MSAL.js with the tenant
client ID, and connect the save action to Microsoft Graph `drive/items`
endpoints. SharePoint assignment workflows can then be layered on top of the
same file model.
