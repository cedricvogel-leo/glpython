import { coreStrings, resolveUiLocale, type CoreStrings, type UiLocale } from 'glpython-editor'

export type Locale = UiLocale

export const localeNames: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
}

// The IDE's own shell strings; everything the workspace shows comes from
// glpython-editor's coreStrings (see translations below).
type ShellStrings = {
  workspaceName: string
  openProject: string
  openFolder: string
  downloadProject: string
  shareLinkCopiedOutput: string
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
  microsoftConnected: string
  signInWithMicrosoft: string
  settings: string
  notSignedIn: string
  courseMenu: string
  renameProject: string
  promptRenameProject: string
  lessonProgress: string
  addFile: string
  renameFile: (path: string) => string
  deleteFile: (path: string) => string
  teacherNoteTitle: string
  teacherNoteBody: string
  pythonReference: string
  unsaved: string
  save: string
  autosaveOff: string
  devTools: string
  clearLocalProject: string
  language: string
  savedOutput: (path: string) => string
  downloadedOutput: (name: string) => string
  openedFolderOutput: (name: string) => string
  folderNotOpened: string
  openedZipOutput: (name: string) => string
  zipNotOpened: string
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
    workspaceName: 'Classroom workspace',
    openProject: 'Open project',
    openFolder: 'Open folder',
    downloadProject: 'Download project',
    shareLinkCopiedOutput: 'Share link copied to the clipboard. Anyone who opens it gets a copy of this project.',
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
    microsoftConnected: 'Microsoft connected',
    signInWithMicrosoft: 'Sign in with Microsoft',
    settings: 'Settings',
    notSignedIn: 'Not signed in',
    courseMenu: 'Course menu',
    renameProject: 'Rename project',
    promptRenameProject: 'Project name',
    lessonProgress: 'Lesson 01 of 08',
    addFile: 'Add file',
    renameFile: (path) => `Rename ${path}`,
    deleteFile: (path) => `Delete ${path}`,
    teacherNoteTitle: "Teacher's note",
    teacherNoteBody: 'Start by changing the name.',
    pythonReference: 'Python reference',
    unsaved: 'Unsaved',
    save: 'Save',
    autosaveOff: 'Autosave is off',
    devTools: 'Development tools',
    clearLocalProject: 'Clear local project',
    language: 'Language',
    savedOutput: (path) => `Saved ${path} to your workspace. OneDrive sync is ready to connect.`,
    downloadedOutput: (name) => `Downloaded ${name} as a ZIP project folder.`,
    openedFolderOutput: (name) => `Opened ${name} from a local folder.`,
    folderNotOpened: 'The folder was not opened.',
    openedZipOutput: (name) => `Opened ${name} from a ZIP project folder.`,
    zipNotOpened: 'That ZIP file could not be opened as a project.',
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
    workspaceName: 'Klassenarbeitsbereich',
    openProject: 'Projekt öffnen',
    openFolder: 'Ordner öffnen',
    downloadProject: 'Projekt herunterladen',
    shareLinkCopiedOutput: 'Freigabelink in die Zwischenablage kopiert. Wer ihn öffnet, erhält eine Kopie dieses Projekts.',
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
    microsoftConnected: 'Mit Microsoft verbunden',
    signInWithMicrosoft: 'Mit Microsoft anmelden',
    settings: 'Einstellungen',
    notSignedIn: 'Nicht angemeldet',
    courseMenu: 'Kursmenü',
    renameProject: 'Projekt umbenennen',
    promptRenameProject: 'Projektname',
    lessonProgress: 'Lektion 01 von 08',
    addFile: 'Datei hinzufügen',
    renameFile: (path) => `${path} umbenennen`,
    deleteFile: (path) => `${path} löschen`,
    teacherNoteTitle: 'Hinweis der Lehrkraft',
    teacherNoteBody: 'Zuerst den Namen ändern.',
    pythonReference: 'Python-Referenz',
    unsaved: 'Nicht gespeichert',
    save: 'Speichern',
    autosaveOff: 'Automatisches Speichern ist deaktiviert',
    devTools: 'Entwicklerwerkzeuge',
    clearLocalProject: 'Lokales Projekt löschen',
    language: 'Sprache',
    savedOutput: (path) => `${path} im Arbeitsbereich gespeichert. OneDrive-Synchronisierung ist bereit zur Verbindung.`,
    downloadedOutput: (name) => `${name} als ZIP-Projektordner heruntergeladen.`,
    openedFolderOutput: (name) => `${name} aus einem lokalen Ordner geöffnet.`,
    folderNotOpened: 'Der Ordner wurde nicht geöffnet.',
    openedZipOutput: (name) => `${name} aus einem ZIP-Projektordner geöffnet.`,
    zipNotOpened: 'Diese ZIP-Datei konnte nicht als Projekt geöffnet werden.',
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
