export type Locale = 'en' | 'de'

export type Translation = {
  workspaceName: string
  openProject: string
  openFolder: string
  downloadProject: string
  microsoftConnected: string
  signInWithMicrosoft: string
  settings: string
  notSignedIn: string
  collapseSidebar: string
  expandSidebar: string
  collapseGraphics: string
  expandGraphics: string
  courseCategory: string
  courseMenu: string
  lessonProgress: string
  projectFiles: string
  addFile: string
  renameFile: (path: string) => string
  deleteFile: (path: string) => string
  teacherNoteTitle: string
  teacherNoteBody: string
  pythonReference: string
  unsaved: string
  resetOutput: string
  save: string
  runProject: string
  running: string
  closeFile: (path: string) => string
  output: string
  pyodideRuntime: string
  runsFile: (mainFile: string) => string
  turtleGraphics: string
  gturtleWindow: string
  graphicsEmptyBefore: string
  graphicsEmptyAfter: string
  graphicsCollapsedLabel: string
  statusRuntime: string
  autosaveOff: string
  footerTagline: string
  devTools: string
  clearLocalProject: string
  language: string
  readyOutput: string
  pythonReadyOutput: string
  noOutput: string
  runningOutput: (mainFile: string) => string
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

export const translations: Record<Locale, Translation> = {
  en: {
    workspaceName: 'Classroom workspace',
    openProject: 'Open project',
    openFolder: 'Open folder',
    downloadProject: 'Download project',
    microsoftConnected: 'Microsoft connected',
    signInWithMicrosoft: 'Sign in with Microsoft',
    settings: 'Settings',
    notSignedIn: 'Not signed in',
    collapseSidebar: 'Collapse files sidebar',
    expandSidebar: 'Expand files sidebar',
    collapseGraphics: 'Collapse graphics window',
    expandGraphics: 'Expand graphics window',
    courseCategory: 'INTRO TO PYTHON',
    courseMenu: 'Course menu',
    lessonProgress: 'Lesson 01 of 08',
    projectFiles: 'PROJECT FILES',
    addFile: 'Add file',
    renameFile: (path) => `Rename ${path}`,
    deleteFile: (path) => `Delete ${path}`,
    teacherNoteTitle: "Teacher's note",
    teacherNoteBody: 'Start by changing the name.',
    pythonReference: 'Python reference',
    unsaved: 'Unsaved',
    resetOutput: 'Reset output',
    save: 'Save',
    runProject: 'Run project',
    running: 'Running...',
    closeFile: (path) => `Close ${path}`,
    output: 'Output',
    pyodideRuntime: 'Pyodide runtime',
    runsFile: (mainFile) => `Runs ${mainFile}`,
    turtleGraphics: 'Turtle graphics',
    gturtleWindow: 'gturtle window',
    graphicsEmptyBefore: 'Run a project that imports',
    graphicsEmptyAfter: 'to see its drawing here.',
    graphicsCollapsedLabel: 'Graphics',
    statusRuntime: 'Python 3.12 in browser',
    autosaveOff: 'Autosave is off',
    footerTagline: 'glpython preview · built for learning',
    devTools: 'Development tools',
    clearLocalProject: 'Clear local project',
    language: 'Deutsch',
    readyOutput: 'Ready when you are. Run your code to see what it does.',
    pythonReadyOutput: 'Python is ready. Run your code to see what it does.',
    noOutput: '(No output)',
    runningOutput: (mainFile) => `Running ${mainFile} and its project files...`,
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
    workspaceName: 'Klassenarbeitsbereich',
    openProject: 'Projekt öffnen',
    openFolder: 'Ordner öffnen',
    downloadProject: 'Projekt herunterladen',
    microsoftConnected: 'Mit Microsoft verbunden',
    signInWithMicrosoft: 'Mit Microsoft anmelden',
    settings: 'Einstellungen',
    notSignedIn: 'Nicht angemeldet',
    collapseSidebar: 'Dateileiste einklappen',
    expandSidebar: 'Dateileiste ausklappen',
    collapseGraphics: 'Grafikfenster einklappen',
    expandGraphics: 'Grafikfenster ausklappen',
    courseCategory: 'EINFÜHRUNG IN PYTHON',
    courseMenu: 'Kursmenü',
    lessonProgress: 'Lektion 01 von 08',
    projectFiles: 'PROJEKTDATEIEN',
    addFile: 'Datei hinzufügen',
    renameFile: (path) => `${path} umbenennen`,
    deleteFile: (path) => `${path} löschen`,
    teacherNoteTitle: 'Hinweis der Lehrkraft',
    teacherNoteBody: 'Beginne damit, den Namen zu ändern.',
    pythonReference: 'Python-Referenz',
    unsaved: 'Nicht gespeichert',
    resetOutput: 'Ausgabe zurücksetzen',
    save: 'Speichern',
    runProject: 'Projekt ausführen',
    running: 'Wird ausgeführt...',
    closeFile: (path) => `${path} schließen`,
    output: 'Ausgabe',
    pyodideRuntime: 'Pyodide-Laufzeit',
    runsFile: (mainFile) => `Führt ${mainFile} aus`,
    turtleGraphics: 'Turtle-Grafik',
    gturtleWindow: 'gturtle-Fenster',
    graphicsEmptyBefore: 'Führe ein Projekt aus, das',
    graphicsEmptyAfter: 'importiert, um die Zeichnung hier zu sehen.',
    graphicsCollapsedLabel: 'Grafik',
    statusRuntime: 'Python 3.12 im Browser',
    autosaveOff: 'Automatisches Speichern ist deaktiviert',
    footerTagline: 'glpython-Vorschau · zum Lernen entwickelt',
    devTools: 'Entwicklerwerkzeuge',
    clearLocalProject: 'Lokales Projekt löschen',
    language: 'English',
    readyOutput: 'Bereit, wenn du es bist. Führe deinen Code aus, um zu sehen, was er tut.',
    pythonReadyOutput: 'Python ist bereit. Führe deinen Code aus, um zu sehen, was er tut.',
    noOutput: '(Keine Ausgabe)',
    runningOutput: (mainFile) => `${mainFile} und die Projektdateien werden ausgeführt...`,
    savedOutput: (path) => `${path} in deinem Arbeitsbereich gespeichert. OneDrive-Synchronisierung ist bereit zur Verbindung.`,
    downloadedOutput: (name) => `${name} als ZIP-Projektordner heruntergeladen.`,
    openedFolderOutput: (name) => `${name} aus einem lokalen Ordner geöffnet.`,
    folderNotOpened: 'Der Ordner wurde nicht geöffnet.',
    openedZipOutput: (name) => `${name} aus einem ZIP-Projektordner geöffnet.`,
    zipNotOpened: 'Diese ZIP-Datei konnte nicht als Projekt geöffnet werden.',
    authInitError: 'Die Microsoft-Anmeldung konnte nicht initialisiert werden.',
    authConfigError: 'Füge VITE_ENTRA_CLIENT_ID zu .env.local hinzu, um die Microsoft-Anmeldung zu aktivieren.',
    authCancelledError: 'Die Microsoft-Anmeldung wurde abgebrochen oder ist fehlgeschlagen.',
    promptFileName: 'Dateiname',
    promptDefaultFileName: 'uebung.py',
    promptRenameFile: 'Datei umbenennen',
    confirmDeleteFile: (path) => `${path} löschen?`,
    confirmClearProject: 'Das gespeicherte lokale Projekt löschen und den Startercode neu laden?',
  },
}

const storageKey = 'glpython-locale'

export function detectLocale(): Locale {
  const stored = localStorage.getItem(storageKey)
  if (stored === 'en' || stored === 'de') return stored

  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language]
  const prefersGerman = browserLanguages.some((language) => language?.toLowerCase().startsWith('de'))
  return prefersGerman ? 'de' : 'en'
}

export function saveLocale(locale: Locale): void {
  localStorage.setItem(storageKey, locale)
}
