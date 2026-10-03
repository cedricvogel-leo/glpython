import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronDown, Download, FileCode2, FolderOpen, Languages, Link2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Plus, Sparkles, SquareTerminal, Trash2, Upload } from 'lucide-react'
import { GlPythonWorkspace, addProjectFile, deleteProjectFile, initialProject, renameProjectFile, updateProjectFile } from 'glpython-editor'
import type { ProjectFileKind } from 'glpython-editor'
import 'glpython-editor/style.css'
import { initializeAuth } from './auth'
import type { AccountInfo } from '@azure/msal-browser'
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

function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale())
  const t = translations[locale]
  const [project, setProject] = useState(() => startupProject)
  const [activeFile, setActiveFile] = useState(() => startupProject.mainFile)
  const [openFiles, setOpenFiles] = useState(() => [startupProject.mainFile])
  const [, setAccount] = useState<AccountInfo | null>(null)
  const [authErrorKey, setAuthErrorKey] = useState<'' | 'init' | 'config' | 'cancelled'>('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  // Closed by default; auto-opened by the workspace itself once a project
  // importing gturtle is actually run, instead of always showing an empty
  // panel for projects that never draw anything.
  const [isGraphicsOpen, setIsGraphicsOpen] = useState(false)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const languageMenuRef = useRef<HTMLDetailsElement | null>(null)

  useEffect(() => {
    saveLocalProject(project)
  }, [project])

  useEffect(() => {
    saveLocale(locale)
  }, [locale])

  useEffect(() => {
    initializeAuth().then(setAccount).catch(() => setAuthErrorKey('init'))
  }, [])

  const selectLocale = (nextLocale: Locale) => {
    setLocale(nextLocale)
    if (languageMenuRef.current) languageMenuRef.current.open = false
  }

  const openFile = (path: string) => {
    setActiveFile(path)
    setOpenFiles((currentFiles) => currentFiles.includes(path) ? currentFiles : [...currentFiles, path])
  }

  const closeFile = (path: string) => {
    if (openFiles.length === 1) return
    const closingIndex = openFiles.indexOf(path)
    const remainingFiles = openFiles.filter((openPath) => openPath !== path)
    setOpenFiles(remainingFiles)
    if (path === activeFile) setActiveFile(remainingFiles[Math.max(0, closingIndex - 1)])
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
    const newFile = { path: requestedPath, label: requestedPath.replace(/\.[^/.]+$/, ''), kind, code: kind === 'python' ? '# Start writing Python here\n' : '' }
    setProject((currentProject) => addProjectFile(currentProject, newFile))
    openFile(requestedPath)
  }

  const renameFile = (path: string) => {
    const requestedPath = window.prompt(t.promptRenameFile, path)?.trim()
    if (!requestedPath || requestedPath === path || project.files[requestedPath]) return
    setProject((currentProject) => renameProjectFile(currentProject, path, requestedPath))
    setOpenFiles((currentFiles) => currentFiles.map((openPath) => openPath === path ? requestedPath : openPath))
    if (activeFile === path) setActiveFile(requestedPath)
  }

  const deleteFile = (path: string) => {
    if (Object.keys(project.files).length === 1 || !window.confirm(t.confirmDeleteFile(path))) return
    const remainingPaths = Object.keys(project.files).filter((filePath) => filePath !== path)
    const nextActiveFile = activeFile === path ? remainingPaths[0] : activeFile
    setProject((currentProject) => deleteProjectFile(currentProject, path))
    setOpenFiles((currentFiles) => {
      const remainingOpenFiles = currentFiles.filter((openPath) => openPath !== path)
      return remainingOpenFiles.length ? remainingOpenFiles : [nextActiveFile]
    })
    if (activeFile === path) setActiveFile(nextActiveFile)
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

  const shareProject = async () => {
    const shareUrl = buildShareUrl(project)
    try {
      await navigator.clipboard.writeText(shareUrl)
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
      setOpenFiles([importedProject.mainFile])
    } catch {
      // Folder picker not supported or cancelled - importProjectFolder already
      // falls back to the hidden zip <input> above when appropriate.
    }
  }

  const openZip = async (file: File) => {
    const importedProject = await importProjectZip(file, project)
    setProject(importedProject)
    setActiveFile(importedProject.mainFile)
    setOpenFiles([importedProject.mainFile])
  }

  const resetLocalProject = () => {
    if (!window.confirm(t.confirmClearProject)) return
    clearLocalProject()
    window.location.reload()
  }

  const authErrorMessage = authErrorKey === 'init' ? t.authInitError : authErrorKey === 'config' ? t.authConfigError : authErrorKey === 'cancelled' ? t.authCancelledError : ''

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><button className="icon-button" aria-label={isSidebarOpen ? t.collapseSidebar : t.expandSidebar} onClick={() => setIsSidebarOpen((open) => !open)}>{isSidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button><div className="brand-mark"><Sparkles size={17} /></div><span>glpython</span></div><div className="topbar-actions"><details className="project-menu"><summary className="workspace-button"><FolderOpen size={15} /><span>{t.openProject}</span><ChevronDown size={13} /></summary><div className="project-menu-options"><button onClick={() => { void openFolder() }}><FolderOpen size={14} /> {t.openFolder}</button><button onClick={() => zipInputRef.current?.click()}><Upload size={14} /> {t.openProject}</button></div></details><button className="workspace-button" onClick={() => { void downloadProject() }}><Download size={15} /><span>{t.downloadProject}</span></button><button className="workspace-button" onClick={() => { void shareProject() }}><Link2 size={15} /><span>{t.shareProject}</span></button><input ref={zipInputRef} className="hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openZip(file); event.target.value = '' }} /><button className="icon-button" aria-label={isGraphicsOpen ? t.collapseGraphics : t.expandGraphics} onClick={() => setIsGraphicsOpen((open) => !open)}>{isGraphicsOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button><details className="project-menu language-menu" ref={languageMenuRef}><summary className="workspace-button" aria-label={t.language}><Languages size={15} /><span>{localeNames[locale]}</span><ChevronDown size={13} /></summary><div className="project-menu-options">{(Object.keys(localeNames) as Locale[]).map((code) => <button key={code} className={code === locale ? 'active' : ''} onClick={() => selectLocale(code)}>{localeNames[code]}</button>)}</div></details></div></header>
      <div className="workspace">
        {isSidebarOpen && <aside className="sidebar"><div className="course-heading"><div><span className="eyebrow">{t.courseCategory}</span><h1>{project.name}</h1></div><button className="icon-button small" aria-label={t.renameProject} title={t.renameProject} onClick={renameProject}><Pencil size={16} /></button></div><nav className="lesson-nav"><div className="nav-section"><span className="nav-label">{t.projectFiles}</span><button className="icon-button small" aria-label={t.addFile} onClick={addFile}><Plus size={16} /></button></div>{Object.values(project.files).map((file) => <div className={`file-item ${activeFile === file.path ? 'active' : ''}`} key={file.path}><button className="file-open-button" onClick={() => openFile(file.path)}><span className={`file-icon ${file.kind === 'python' ? 'python' : 'notes'}`}>{file.kind === 'python' ? <FileCode2 size={15} /> : <BookOpen size={15} />}</span><span>{file.label}</span>{openFiles.includes(file.path) && <span className="open-file-mark" />}</button><span className="file-actions"><button className="file-action" aria-label={t.renameFile(file.path)} onClick={() => renameFile(file.path)}><Pencil size={13} /></button><button className="file-action danger" aria-label={t.deleteFile(file.path)} onClick={() => deleteFile(file.path)}><Trash2 size={13} /></button></span></div>)}</nav><div className="sidebar-bottom"><a className="help-link" href="https://docs.python.org/3/reference/index.html" target="_blank" rel="noreferrer"><SquareTerminal size={16} /> {t.pythonReference}</a></div></aside>}
        <main className="main-area">
          {authErrorMessage && <div className="auth-notice" role="status">{authErrorMessage}</div>}
          <GlPythonWorkspace
            project={project}
            activeFile={activeFile}
            openFiles={openFiles}
            onOpenFile={openFile}
            onCloseFile={closeFile}
            onFileCodeChange={(path, code) => setProject((currentProject) => updateProjectFile(currentProject, path, code))}
            isGraphicsOpen={isGraphicsOpen}
            onGraphicsOpenChange={setIsGraphicsOpen}
            t={t}
          />
        </main>
      </div>
      <footer className="statusbar"><span><span className="status-dot" /> {t.statusRuntime}</span><span>{t.footerTagline}</span></footer>
      <div className="devbar"><span>{t.devTools}</span><button onClick={resetLocalProject}><Trash2 size={13} /> {t.clearLocalProject}</button></div>
    </div>
  )
}

export default App
