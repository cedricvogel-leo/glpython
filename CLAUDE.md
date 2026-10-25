# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The glpython IDE: a browser Python IDE for the classroom, deployed to GitHub Pages at `/glpython/`. It is only the **shell**: header, file sidebar, language menu, Microsoft sign-in (MSAL redirect flow) and project persistence (local storage, folder/ZIP import, ZIP export, share links). Everything inside the workspace is the `<GlPythonWorkspace>` component from **glpython-editor** (`../glpython-editor`): the Monaco editor, the Pyodide worker, the REPL, the visualizer, the turtle panel. Changes to those belong there, not here.

Sibling repos: `../glpython-editor` (the component, runtime and LiaScript embed; read its CLAUDE.md) and `../glpython-liascript` (the LiaScript macro).

## Commands

```bash
npm run dev     # vite with COOP/COEP headers (input() needs SharedArrayBuffer)
npm run build   # tsc -b && vite build (base /glpython/)
npm run lint    # oxlint; 7 known warnings, all in the vendored public/coi-serviceworker.js
```

There are no tests. `.github/workflows/ci.yml` runs `npm ci`, the build (tsc catches type changes in a new editor tag) and lint on every pull request. Pushes to `main` deploy to GitHub Pages (`deploy-pages.yml`). To check a change in the browser, use `npm run dev`. `npm run preview` doesn't serve the `/glpython/` base (README «Deployment»).

## Layout

- `src/App.tsx` — the shell. It renders `GlPythonWorkspace` and uses glpython-editor's project helpers (`addProjectFile`, `renameProjectFile`, …).
- `src/i18n.ts` — only the shell's own strings (`ShellStrings`, de/en). The workspace's strings come from glpython-editor's `coreStrings`, so don't copy them here. A new workspace string goes into glpython-editor's `src/i18n.ts`.
- `src/projectStorage.ts` (local storage, folder/ZIP) and `src/projectShare.ts` (`?project=` share links, lz-string, versioned payload).
- `src/auth.ts` — MSAL. Only active with `VITE_ENTRA_CLIENT_ID` in `.env.local` (README «Microsoft sign-in»).
- `vite.config.ts` — `optimizeDeps.exclude: ['glpython-editor']` keeps the editor's worker next to its `dist/index.js`. Don't remove it.

## glpython-editor dependency

- `package.json` pins `glpython-editor` by tag: `git+https://github.com/glpython-edu/glpython-editor.git#vX.Y.Z`. The editor's `prepare` script builds its `dist/` on install.
- **Bumping it** (after the tag exists in glpython-editor; see that repo's CLAUDE.md «Releases»):
  1. On a branch, run `npm install "glpython-editor@git+https://github.com/glpython-edu/glpython-editor.git#vX.Y.Z"`.
  2. npm rewrites the spec as `github:…`. Restore the `git+https://…` form in `package.json` and `package-lock.json`, so the diff is the tag plus the lock's `resolved` commit.
  3. Run `npm ci && npm run build`, check that `node_modules/glpython-editor/dist` contains the new code, and open a PR titled «Bump glpython-editor to vX.Y.Z».
- **Trying an unreleased editor change:** build it in `../glpython-editor`, temporarily replace `node_modules/glpython-editor/dist` with its `dist/` (back it up first), run `npm run build`, then restore. Alternatively `npm install ../glpython-editor`, but then restore `package.json`/`package-lock.json` before committing.

## Conventions

- Work on a branch from `main`, one PR per package of work, CI green before handing over. Merging to `main` deploys the IDE.
- UI texts in German and English. German uses Swiss spelling (ss, no ß) and never addresses the learner as «du» or «Sie».
- Behaviour must match CPython. The runtime lives in glpython-editor, so a Python discrepancy is fixed there.
- Report follow-ups instead of fixing them silently.
- Code comments explain why, in full sentences, like the existing ones.
