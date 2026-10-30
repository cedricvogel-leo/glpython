import { coreStrings, resolveUiLocale, type CoreStrings, type UiLocale } from 'glpython-editor'

export type Locale = UiLocale

export const localeNames: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
}

// The IDE's own shell strings; everything the workspace shows comes from
// glpython-editor's coreStrings (see translations below).
type ShellStrings = {
  openProject: string
  openFolder: string
  downloadProject: string
  shareLinkPromptLabel: string
  share: string
  shareCopied: string
  moreActions: string
  files: string
  closeFiles: string
  projectName: string
  ideTools: string
  restartPython: string
  projectMenu: string
  renameProject: string
  promptRenameProject: string
  addFile: string
  renameFile: (path: string) => string
  deleteFile: (path: string) => string
  pythonReference: string
  newProject: string
  recentlyClosed: string
  recentlyClosedHint: string
  recentlyClosedEmpty: string
  openClosed: string
  removeClosed: (file: string) => string
  showAllClosed: string
  lastEdited: (file: string, when: string) => string
  justNow: string
  dismiss: string
  updateAvailable: string
  reloadNow: string
  language: string
  authInitError: string
  authConfigError: string
  authCancelledError: string
  promptFileName: string
  promptDefaultFileName: string
  promptRenameFile: string
  confirmDeleteFile: (path: string) => string
}

export type Translation = CoreStrings & ShellStrings

export const translations: Record<Locale, Translation> = {
  en: {
    ...coreStrings.en,
    openProject: 'Open project',
    openFolder: 'Open folder',
    downloadProject: 'Download project',
    shareLinkPromptLabel: 'Copy this share link:',
    share: 'Share',
    shareCopied: 'Link copied ✓',
    moreActions: 'More actions',
    files: 'Files',
    closeFiles: 'Close files',
    projectName: 'Project name',
    ideTools: 'Tools',
    restartPython: 'Restart Python',
    projectMenu: 'Project',
    renameProject: 'Rename project',
    promptRenameProject: 'Project name',
    addFile: 'Add file',
    renameFile: (path) => `Rename ${path}`,
    deleteFile: (path) => `Delete ${path}`,
    pythonReference: 'Python reference',
    newProject: 'New project',
    recentlyClosed: 'Recently closed',
    recentlyClosedHint: 'Projects of closed tabs, kept in this browser for 14 days.',
    recentlyClosedEmpty: 'No projects closed in the last 14 days.',
    openClosed: 'Open',
    removeClosed: (file) => `Remove ${file}`,
    showAllClosed: 'Show all',
    lastEdited: (file, when) => `Last edited: ${file} (${when}).`,
    justNow: 'just now',
    dismiss: 'Close',
    updateAvailable: 'A new version is available.',
    reloadNow: 'Reload',
    language: 'Language',
    authInitError: 'Microsoft sign-in could not be initialized.',
    authConfigError: 'Add VITE_ENTRA_CLIENT_ID to .env.local to enable Microsoft sign-in.',
    authCancelledError: 'Microsoft sign-in was cancelled or failed.',
    promptFileName: 'File name',
    promptDefaultFileName: 'exercise.py',
    promptRenameFile: 'Rename file',
    confirmDeleteFile: (path) => `Delete ${path}?`,
  },
  de: {
    ...coreStrings.de,
    openProject: 'Projekt öffnen',
    openFolder: 'Ordner öffnen',
    downloadProject: 'Projekt herunterladen',
    shareLinkPromptLabel: 'Diesen Freigabelink kopieren:',
    share: 'Teilen',
    shareCopied: 'Link kopiert ✓',
    moreActions: 'Weitere Aktionen',
    files: 'Dateien',
    closeFiles: 'Dateien schliessen',
    projectName: 'Projektname',
    ideTools: 'Werkzeuge',
    restartPython: 'Python neu starten',
    projectMenu: 'Projekt',
    renameProject: 'Projekt umbenennen',
    promptRenameProject: 'Projektname',
    addFile: 'Datei hinzufügen',
    renameFile: (path) => `${path} umbenennen`,
    deleteFile: (path) => `${path} löschen`,
    pythonReference: 'Python-Referenz',
    newProject: 'Neues Projekt',
    recentlyClosed: 'Zuletzt geschlossen',
    recentlyClosedHint: 'Projekte aus geschlossenen Tabs, 14 Tage lang in diesem Browser gespeichert.',
    recentlyClosedEmpty: 'Keine geschlossenen Projekte aus den letzten 14 Tagen.',
    openClosed: 'Öffnen',
    removeClosed: (file) => `${file} entfernen`,
    showAllClosed: 'Alle anzeigen',
    lastEdited: (file, when) => `Zuletzt bearbeitet: ${file} (${when}).`,
    justNow: 'gerade eben',
    dismiss: 'Schliessen',
    updateAvailable: 'Neue Version verfügbar.',
    reloadNow: 'Neu laden',
    language: 'Sprache',
    authInitError: 'Die Microsoft-Anmeldung konnte nicht initialisiert werden.',
    authConfigError: 'Für die Microsoft-Anmeldung VITE_ENTRA_CLIENT_ID in .env.local eintragen.',
    authCancelledError: 'Die Microsoft-Anmeldung wurde abgebrochen oder ist fehlgeschlagen.',
    promptFileName: 'Dateiname',
    promptDefaultFileName: 'uebung.py',
    promptRenameFile: 'Datei umbenennen',
    confirmDeleteFile: (path) => `${path} löschen?`,
  },
}

const storageKey = 'glpython-locale'

// The learner's explicit choice in the language menu, else the browser's
// language, else English (see resolveUiLocale). Only an explicit choice is
// stored, so a learner who never picked one keeps following the browser.
export function detectLocale(): Locale {
  const stored = localStorage.getItem(storageKey)
  if (stored === 'en' || stored === 'de') return stored
  return resolveUiLocale(navigator.language)
}

export function saveLocale(locale: Locale): void {
  localStorage.setItem(storageKey, locale)
}
