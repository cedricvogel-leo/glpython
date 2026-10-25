import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { BookOpen, CircleHelp, Download, EllipsisVertical, FileCode2, Folder, FolderOpen, Link2, Pencil, Plus, RotateCcw, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { GlPythonWorkspace, addProjectFile, deleteProjectFile, initialProject, renameProjectFile, updateProjectFile } from 'glpython-editor'
import type { ProjectFileKind, WorkspaceCommand } from 'glpython-editor'
import 'glpython-editor/style.css'
import { initializeAuth } from './auth'
import { clearLocalProject, exportProjectZip, importProjectFolder, importProjectZip, loadLocalProject, saveLocalProject } from './projectStorage'
import { buildShareUrl, consumeSharedProjectFromLocation } from './projectShare'
import { detectLocale, localeNames, saveLocale, translations, type Locale } from './i18n'

// Resolves the project to start the app with: a project shared via the
// `?project=` URL parameter takes priority (and is immediately persisted +
// stripped from the address bar so reloading keeps it without re-decoding),
// otherwise falls back to whatever was last saved locally. Runs once at
// module load, since every useState initializer below needs the same
// result.
const startupProject = (() => {
  const sharedProject = consumeSharedProjectFromLocation()
  if (sharedProject) {
    saveLocalProject(sharedProject)
    return sharedProject
  }
  return loadLocalProject(initialProject)
})()

// Moves keyboard focus through a menu's items with the arrow keys, Home and
// End, as a menu does; Escape is the caller's.
function moveMenuFocus(event: ReactKeyboardEvent<HTMLElement>, menu: HTMLElement | null) {
  const items = [...(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
  if (items.length === 0) return
  const index = items.indexOf(document.activeElement as HTMLElement)
  const next = ({ ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[event.key]
  if (next === undefined) return
  event.preventDefault()
  items[(next + items.length) % items.length].focus()
}

// The IDE is the embed, only larger (P18): one bar on top with the
// workspace's own buttons (▶ Ausführen · Tests · Visualisieren, put there by
// the workspace), Teilen and a ⋮ menu for what is rarely needed (among it
// «Python neu starten»: ▶ already starts afresh and ■ stops a hung program,
// and learners read «Zurücksetzen» as "reset my code");
// at the left edge the files (a drawer) and the Python reference; below, the
// workspace in its stacked layout.
function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale())
  const t = translations[locale]
  const [project, setProject] = useState(() => startupProject)
  const [activeFile, setActiveFile] = useState(() => startupProject.mainFile)
  const [authErrorKey, setAuthErrorKey] = useState<'' | 'init' | 'config' | 'cancelled'>('')
  // The workspace decides itself when to show graphics (only while the
  // program draws); these props are for hosts with their own toggle.
  const [isGraphicsOpen, setIsGraphicsOpen] = useState(false)
  const [actionsContainer, setActionsContainer] = useState<HTMLDivElement | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  // «Python neu starten»: the workspace's reset command - a new Python and an
  // empty console, as the embed's Reset; the code is the IDE's and stays.
  const [workspaceCommand, setWorkspaceCommand] = useState<WorkspaceCommand | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const drawerRef = useRef<HTMLElement | null>(null)
  const filesButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    saveLocalProject(project)
  }, [project])

  useEffect(() => {
    initializeAuth().catch(() => setAuthErrorKey('init'))
  }, [])

  // The drawer and the menu take keyboard focus when they open; a click
  // elsewhere closes them (the drawer: anywhere but itself and 📁).
  useEffect(() => {
    if (!isDrawerOpen) return
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus()
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!drawerRef.current?.contains(event.target as Node) && !filesButtonRef.current?.contains(event.target as Node)) setIsDrawerOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [isDrawerOpen])
  useEffect(() => {
    if (!isMenuOpen) return
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !menuButtonRef.current?.contains(event.target as Node)) setIsMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [isMenuOpen])

  const closeDrawer = () => {
    setIsDrawerOpen(false)
    filesButtonRef.current?.focus()
  }
  const closeMenu = () => {
    setIsMenuOpen(false)
    menuButtonRef.current?.focus()
  }
  // A menu item: closes the menu, then acts.
  const fromMenu = (action: () => void) => () => {
    setIsMenuOpen(false)
    action()
  }

  const selectLocale = (nextLocale: Locale) => {
    setLocale(nextLocale)
    saveLocale(nextLocale)
  }

  const renameProject = () => {
    const requestedName = window.prompt(t.promptRenameProject, project.name)?.trim()
    if (!requestedName || requestedName === project.name) return
    setProject((currentProject) => ({ ...currentProject, name: requestedName }))
  }

  const addFile = () => {
    const requestedPath = window.prompt(t.promptFileName, t.promptDefaultFileName)?.trim()
    if (!requestedPath || project.files[requestedPath]) return
    const kind: ProjectFileKind = requestedPath.endsWith('.py') ? 'python' : 'text'
    const newFile = { path: requestedPath, label: requestedPath.replace(/\.[^/.]+$/, ''), kind, code: '' }
    setProject((currentProject) => addProjectFile(currentProject, newFile))
    setActiveFile(requestedPath)
  }

  const renameFile = (path: string) => {
    const requestedPath = window.prompt(t.promptRenameFile, path)?.trim()
    if (!requestedPath || requestedPath === path || project.files[requestedPath]) return
    setProject((currentProject) => renameProjectFile(currentProject, path, requestedPath))
    if (activeFile === path) setActiveFile(requestedPath)
  }

  const deleteFile = (path: string) => {
    if (Object.keys(project.files).length === 1 || !window.confirm(t.confirmDeleteFile(path))) return
    const remainingPaths = Object.keys(project.files).filter((filePath) => filePath !== path)
    setProject((currentProject) => deleteProjectFile(currentProject, path))
    if (activeFile === path) setActiveFile(remainingPaths[0])
  }

  const downloadProject = async () => {
    const blob = await exportProjectZip(project)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.zip`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Teilen: the link to a copy of this project, copied with a short
  // confirmation beside the button, or shown to copy by hand.
  const shareProject = async () => {
    const shareUrl = buildShareUrl(project)
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 3000)
    } catch {
      window.prompt(t.shareLinkPromptLabel, shareUrl)
    }
  }

  const openFolder = async () => {
    try {
      const importedProject = await importProjectFolder(project)
      if (!importedProject) {
        zipInputRef.current?.click()
        return
      }
      setProject(importedProject)
      setActiveFile(importedProject.mainFile)
    } catch {
      // Folder picker not supported or cancelled - importProjectFolder already
      // falls back to the hidden zip <input> above when appropriate.
    }
  }

  const openZip = async (file: File) => {
    const importedProject = await importProjectZip(file, project)
    setProject(importedProject)
    setActiveFile(importedProject.mainFile)
  }

  const resetLocalProject = () => {
    if (!window.confirm(t.confirmClearProject)) return
    clearLocalProject()
    window.location.reload()
  }

  const authErrorMessage = authErrorKey === 'init' ? t.authInitError : authErrorKey === 'config' ? t.authConfigError : authErrorKey === 'cancelled' ? t.authCancelledError : ''
  const filePaths = Object.keys(project.files)

  return (
    <div className="ide">
      <header className="ide-bar">
        <div className="ide-brand"><span className="ide-brand-mark" aria-hidden="true"><Sparkles size={16} /></span><span>glpython</span></div>
        <div className="ide-actions" ref={setActionsContainer} />
        <div className="ide-bar-end">
          {shareCopied && <span className="ide-share-status" role="status">{t.shareCopied}</span>}
          <button type="button" className="secondary-button" onClick={() => { void shareProject() }}><Link2 size={15} /> {t.share}</button>
          <div className="ide-menu">
            <button type="button" ref={menuButtonRef} className="icon-button ide-menu-button" aria-label={t.moreActions} title={t.moreActions} aria-haspopup="menu" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen((open) => !open)}><EllipsisVertical size={18} /></button>
            {isMenuOpen && <div className="ide-menu-list" role="menu" ref={menuRef} aria-label={t.moreActions} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeMenu() } else if (event.key === 'Tab') setIsMenuOpen(false); else moveMenuFocus(event, menuRef.current) }}>
              <button type="button" role="menuitem" onClick={fromMenu(() => setWorkspaceCommand((current) => ({ id: (current?.id ?? 0) + 1, type: 'reset' })))}><RotateCcw size={15} /> {t.restartPython}</button>
              <div className="ide-menu-group" role="group" aria-label={t.projectMenu}>
              <button type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); void openFolder() }}><FolderOpen size={15} /> {t.openFolder}</button>
              <button type="button" role="menuitem" onClick={() => { setIsMenuOpen(false); zipInputRef.current?.click() }}><Upload size={15} /> {t.openProject}</button>
              <button type="button" role="menuitem" onClick={fromMenu(() => { void downloadProject() })}><Download size={15} /> {t.downloadProject}</button>
              </div>
              <div className="ide-menu-group" role="group" aria-label={t.language}>
                <span className="ide-menu-label" aria-hidden="true">{t.language}</span>
                {(Object.keys(localeNames) as Locale[]).map((code) => <button type="button" key={code} role="menuitemradio" aria-checked={code === locale} onClick={fromMenu(() => selectLocale(code))}><span className="ide-menu-check" aria-hidden="true" /> {localeNames[code]}</button>)}
              </div>
              <div className="ide-menu-group" role="group" aria-label={t.devTools}>
                <span className="ide-menu-label" aria-hidden="true">{t.devTools}</span>
                <button type="button" role="menuitem" className="ide-menu-danger" onClick={fromMenu(resetLocalProject)}><Trash2 size={15} /> {t.clearLocalProject}</button>
              </div>
            </div>}
          </div>
          <input ref={zipInputRef} className="hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openZip(file); event.target.value = '' }} />
        </div>
      </header>
      <div className="ide-body">
        <nav className="ide-rail" aria-label={t.ideTools}>
          <button type="button" ref={filesButtonRef} className="icon-button" aria-label={t.files} title={t.files} aria-expanded={isDrawerOpen} aria-controls="ide-files" onClick={() => setIsDrawerOpen((open) => !open)}><Folder size={19} /></button>
          <a className="icon-button" href="https://docs.python.org/3/reference/index.html" target="_blank" rel="noreferrer" aria-label={t.pythonReference} title={t.pythonReference}><CircleHelp size={19} /></a>
        </nav>
        {isDrawerOpen && <aside id="ide-files" className="ide-drawer" ref={drawerRef} aria-label={t.files} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); closeDrawer() } }}>
          <div className="ide-drawer-head">
            <span className="ide-drawer-title">{t.files}</span>
            <button type="button" className="icon-button small" aria-label={t.closeFiles} title={t.closeFiles} onClick={closeDrawer}><X size={16} /></button>
          </div>
          <div className="ide-project-name">
            <span className="ide-project-label">{t.projectName}</span>
            <div className="ide-project-row"><strong>{project.name}</strong><button type="button" className="icon-button small" aria-label={t.renameProject} title={t.renameProject} onClick={renameProject}><Pencil size={15} /></button></div>
          </div>
          <ul className="ide-file-list">
            {filePaths.map((path) => { const file = project.files[path]; return <li key={path} className={path === activeFile ? 'active' : undefined}>
              <button type="button" className="ide-file-open" aria-current={path === activeFile ? 'true' : undefined} onClick={() => setActiveFile(path)}>{file.kind === 'python' ? <FileCode2 size={15} /> : <BookOpen size={15} />}<span>{path}</span></button>
              <button type="button" className="icon-button small" aria-label={t.renameFile(path)} title={t.renameFile(path)} onClick={() => renameFile(path)}><Pencil size={14} /></button>
              <button type="button" className="icon-button small ide-file-delete" aria-label={t.deleteFile(path)} title={t.deleteFile(path)} disabled={filePaths.length === 1} onClick={() => deleteFile(path)}><Trash2 size={14} /></button>
            </li> })}
          </ul>
          <button type="button" className="secondary-button ide-new-file" onClick={addFile}><Plus size={15} /> {t.addFile}</button>
        </aside>}
        <main className="ide-main">
          {authErrorMessage && <div className="auth-notice" role="status">{authErrorMessage}</div>}
          <GlPythonWorkspace
            project={project}
            activeFile={activeFile}
            openFiles={filePaths}
            onOpenFile={setActiveFile}
            onCloseFile={() => undefined}
            onFileCodeChange={(path, code) => setProject((currentProject) => updateProjectFile(currentProject, path, code))}
            isGraphicsOpen={isGraphicsOpen}
            onGraphicsOpenChange={setIsGraphicsOpen}
            actionsContainer={actionsContainer}
            command={workspaceCommand}
            capabilities={{ breadcrumbs: false, closeFileTabs: false, resetOutput: false }}
            t={t}
          />
        </main>
      </div>
    </div>
  )
}

export default App
