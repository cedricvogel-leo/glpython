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
  devTools: string
  clearLocalProject: string
  language: string
  authInitError: string
  authConfigError: string
  authCancelledError: string
  promptFileName: string
  promptDefaultFileName: string
  promptRenameFile: string
  confirmDeleteFile: (path: string) => string
  confirmClearProject: string
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
    devTools: 'Development tools',
    clearLocalProject: 'Clear local project',
    language: 'Language',
    authInitError: 'Microsoft sign-in could not be initialized.',
    authConfigError: 'Add VITE_ENTRA_CLIENT_ID to .env.local to enable Microsoft sign-in.',
    authCancelledError: 'Microsoft sign-in was cancelled or failed.',
    promptFileName: 'File name',
    promptDefaultFileName: 'exercise.py',
    promptRenameFile: 'Rename file',
    confirmDeleteFile: (path) => `Delete ${path}?`,
    confirmClearProject: 'Clear the saved local project and reload the starter?',
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
    devTools: 'Entwicklerwerkzeuge',
    clearLocalProject: 'Lokales Projekt löschen',
    language: 'Sprache',
    authInitError: 'Die Microsoft-Anmeldung konnte nicht initialisiert werden.',
    authConfigError: 'Für die Microsoft-Anmeldung VITE_ENTRA_CLIENT_ID in .env.local eintragen.',
    authCancelledError: 'Die Microsoft-Anmeldung wurde abgebrochen oder ist fehlgeschlagen.',
    promptFileName: 'Dateiname',
    promptDefaultFileName: 'uebung.py',
    promptRenameFile: 'Datei umbenennen',
    confirmDeleteFile: (path) => `${path} löschen?`,
    confirmClearProject: 'Das gespeicherte lokale Projekt löschen und den Startercode neu laden?',
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
