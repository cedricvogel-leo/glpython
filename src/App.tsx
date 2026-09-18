import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { BookOpen, ChevronDown, Cloud, Download, FileCode2, FolderOpen, GraduationCap, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil, Play, Plus, RotateCcw, Save, Settings2, Sparkles, SquareTerminal, Trash2, Upload, UserRound, X } from 'lucide-react'
import { addProjectFile, deleteProjectFile, initialProject, renameProjectFile, updateProjectFile } from './project'
import type { ProjectFileKind } from './project'
import { initializeAuth, isAuthConfigured, signIn, signOut } from './auth'
import type { AccountInfo } from '@azure/msal-browser'
import { clearLocalProject, exportProjectZip, importProjectFolder, importProjectZip, loadLocalProject, saveLocalProject } from './projectStorage'
import { GraphicsWindow, type TurtleCommand } from './GraphicsWindow'
import './App.css'

function App() {
  const [project, setProject] = useState(() => loadLocalProject(initialProject))
  const [activeFile, setActiveFile] = useState(() => loadLocalProject(initialProject).mainFile)
  const [openFiles, setOpenFiles] = useState(() => [loadLocalProject(initialProject).mainFile])
  const [output, setOutput] = useState('Ready when you are. Run your code to see what it does.')
  const [graphics, setGraphics] = useState<TurtleCommand[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isSaved, setIsSaved] = useState(true)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [authError, setAuthError] = useState('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isGraphicsOpen, setIsGraphicsOpen] = useState(true)
  const workerRef = useRef<Worker | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const selectedFile = project.files[activeFile] ?? project.files[project.mainFile]

  useEffect(() => {
    saveLocalProject(project)
  }, [project])

  useEffect(() => {
    initializeAuth().then(setAccount).catch(() => setAuthError('Microsoft sign-in could not be initialized.'))
  }, [])

  const handleAuthClick = async () => {
    setAuthError('')
    if (!isAuthConfigured) {
      setAuthError('Add VITE_ENTRA_CLIENT_ID to .env.local to enable Microsoft sign-in.')
      return
    }
    try {
      if (account) {
        await signOut()
        setAccount(null)
      } else {
        setAccount(await signIn())
      }
    } catch {
      setAuthError('Microsoft sign-in was cancelled or failed.')
    }
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

  const addFile = () => {
    const requestedPath = window.prompt('File name', 'exercise.py')?.trim()
    if (!requestedPath || project.files[requestedPath]) return
    const kind: ProjectFileKind = requestedPath.endsWith('.py') ? 'python' : 'text'
    const newFile = { path: requestedPath, label: requestedPath.replace(/\.[^/.]+$/, ''), kind, code: kind === 'python' ? '# Start writing Python here\n' : '' }
    setProject((currentProject) => addProjectFile(currentProject, newFile))
    openFile(requestedPath)
    setIsSaved(false)
  }

  const renameFile = (path: string) => {
    const requestedPath = window.prompt('Rename file', path)?.trim()
    if (!requestedPath || requestedPath === path || project.files[requestedPath]) return
    setProject((currentProject) => renameProjectFile(currentProject, path, requestedPath))
    setOpenFiles((currentFiles) => currentFiles.map((openPath) => openPath === path ? requestedPath : openPath))
    if (activeFile === path) setActiveFile(requestedPath)
    setIsSaved(false)
  }

  const deleteFile = (path: string) => {
    if (Object.keys(project.files).length === 1 || !window.confirm(`Delete ${path}?`)) return
    const remainingPaths = Object.keys(project.files).filter((filePath) => filePath !== path)
    const nextActiveFile = activeFile === path ? remainingPaths[0] : activeFile
    setProject((currentProject) => deleteProjectFile(currentProject, path))
    setOpenFiles((currentFiles) => {
      const remainingOpenFiles = currentFiles.filter((openPath) => openPath !== path)
      return remainingOpenFiles.length ? remainingOpenFiles : [nextActiveFile]
    })
    if (activeFile === path) setActiveFile(nextActiveFile)
    setIsSaved(false)
  }

  useEffect(() => {
    const worker = new Worker('/pyodide-worker.js')
    worker.onmessage = (event: MessageEvent<{ type: string; output?: string; graphics?: TurtleCommand[] }>) => {
      if (event.data.type === 'ready') setOutput('Python is ready. Run your code to see what it does.')
      if (event.data.type === 'result' || event.data.type === 'error') { setOutput(event.data.output || '(No output)'); setGraphics(event.data.graphics ?? []); setIsRunning(false) }
    }
    workerRef.current = worker
    return () => worker.terminate()
  }, [])

  const updateCode = (code: string | undefined) => {
    setProject((currentProject) => updateProjectFile(currentProject, activeFile, code ?? ''))
    setIsSaved(false)
  }
  const runCode = () => {
    if (!workerRef.current) return
    setIsRunning(true); setOutput(`Running ${project.mainFile} and its project files...`)
    workerRef.current.postMessage({
      type: 'run',
      project: {
        mainFile: project.mainFile,
        files: Object.fromEntries(Object.entries(project.files).map(([path, file]) => [path, file.code])),
      },
    })
  }
  const saveFile = () => { setIsSaved(true); setOutput(`Saved ${selectedFile.path} to your workspace. OneDrive sync is ready to connect.`) }

  const downloadProject = async () => {
    const blob = await exportProjectZip(project)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.zip`
    link.click()
    URL.revokeObjectURL(url)
    setOutput(`Downloaded ${project.name} as a ZIP project folder.`)
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
      setIsSaved(true)
      setOutput(`Opened ${importedProject.name} from a local folder.`)
    } catch {
      setOutput('The folder was not opened.')
    }
  }

  const openZip = async (file: File) => {
    try {
      const importedProject = await importProjectZip(file, project)
      setProject(importedProject)
      setActiveFile(importedProject.mainFile)
      setOpenFiles([importedProject.mainFile])
      setIsSaved(true)
      setOutput(`Opened ${importedProject.name} from a ZIP project folder.`)
    } catch {
      setOutput('That ZIP file could not be opened as a project.')
    }
  }

  const resetLocalProject = () => {
    if (!window.confirm('Clear the saved local project and reload the starter?')) return
    clearLocalProject()
    window.location.reload()
  }

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><button className="icon-button" aria-label={isSidebarOpen ? 'Collapse files sidebar' : 'Expand files sidebar'} onClick={() => setIsSidebarOpen((open) => !open)}>{isSidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button><div className="brand-mark"><Sparkles size={17} /></div><span>glpython</span><span className="brand-divider">/</span><span className="workspace-name">Classroom workspace</span></div><div className="topbar-actions"><details className="project-menu"><summary className="workspace-button"><FolderOpen size={15} /><span>Open project</span><ChevronDown size={13} /></summary><div className="project-menu-options"><button onClick={() => { void openFolder() }}><FolderOpen size={14} /> Open folder</button><button onClick={() => zipInputRef.current?.click()}><Upload size={14} /> Open project</button></div></details><button className="workspace-button" onClick={downloadProject}><Download size={15} /><span>Download project</span></button><input ref={zipInputRef} className="hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openZip(file); event.target.value = '' }} /><button className={`cloud-status ${account ? 'connected' : ''}`} onClick={handleAuthClick}><Cloud size={16} /><span>{account ? 'Microsoft connected' : 'Sign in with Microsoft'}</span></button><button className="icon-button" aria-label={isGraphicsOpen ? 'Collapse graphics window' : 'Expand graphics window'} onClick={() => setIsGraphicsOpen((open) => !open)}>{isGraphicsOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button><button className="icon-button" aria-label="Settings"><Settings2 size={18} /></button><div className="avatar" title={account?.username ?? 'Not signed in'}><UserRound size={16} /></div></div></header>
      <div className="workspace">
        {isSidebarOpen && <aside className="sidebar"><div className="course-heading"><div><span className="eyebrow">INTRO TO PYTHON</span><h1>{project.name}</h1></div><button className="icon-button small" aria-label="Course menu"><ChevronDown size={16} /></button></div><div className="progress-row"><span>Lesson 01 of 08</span><strong>12%</strong></div><div className="progress-track"><span /></div><nav className="lesson-nav"><div className="nav-section"><span className="nav-label">PROJECT FILES</span><button className="icon-button small" aria-label="Add file" onClick={addFile}><Plus size={16} /></button></div>{Object.values(project.files).map((file) => <div className={`file-item ${activeFile === file.path ? 'active' : ''}`} key={file.path}><button className="file-open-button" onClick={() => openFile(file.path)}><span className={`file-icon ${file.kind === 'python' ? 'python' : 'notes'}`}>{file.kind === 'python' ? <FileCode2 size={15} /> : <BookOpen size={15} />}</span><span>{file.label}</span>{openFiles.includes(file.path) && <span className="open-file-mark" />}</button><span className="file-actions"><button className="file-action" aria-label={`Rename ${file.path}`} onClick={() => renameFile(file.path)}><Pencil size={13} /></button><button className="file-action danger" aria-label={`Delete ${file.path}`} onClick={() => deleteFile(file.path)}><Trash2 size={13} /></button></span></div>)}</nav><div className="sidebar-bottom"><div className="teacher-note"><GraduationCap size={18} /><div><strong>Teacher's note</strong><span>Start by changing the name.</span></div></div><button className="help-link"><SquareTerminal size={16} /> Python reference</button></div></aside>}
        <main className="main-area">{authError && <div className="auth-notice" role="status">{authError}</div>}<div className="main-split"><div className="editor-column"><div className="editor-header"><div className="breadcrumbs"><span>{project.name}</span><span>/</span><strong>{selectedFile.path}</strong>{!isSaved && <span className="unsaved">Unsaved</span>}</div><div className="editor-actions"><button className="secondary-button" onClick={() => setOutput('Ready when you are. Run your code to see what it does.')}><RotateCcw size={15} /> Reset output</button><button className="secondary-button" onClick={saveFile}><Save size={15} /> Save</button><button className="run-button" onClick={runCode} disabled={isRunning}><Play size={15} fill="currentColor" /> {isRunning ? 'Running...' : 'Run project'}</button></div></div><section className="editor-panel"><div className="editor-tabs">{openFiles.map((path) => { const file = project.files[path]; return <button className={`editor-tab ${activeFile === path ? 'active' : ''}`} key={path} onClick={() => setActiveFile(path)}><span className={`tab-file-icon ${file.kind === 'python' ? 'python' : 'notes'}`}>{file.kind === 'python' ? <FileCode2 size={14} /> : <BookOpen size={14} />}</span><span>{file.path}</span><span className="tab-close" role="button" aria-label={`Close ${file.path}`} onClick={(event) => { event.stopPropagation(); closeFile(path) }}><X size={13} /></span></button> })}</div><div className="editor-wrap"><Editor height="100%" language={selectedFile.kind === 'python' ? 'python' : 'markdown'} theme="vs-dark" value={selectedFile.code} onChange={updateCode} options={{ minimap: { enabled: false }, fontSize: 15, lineHeight: 24, padding: { top: 22 }, fontFamily: "'JetBrains Mono', monospace", scrollBeyondLastLine: false, smoothScrolling: true, automaticLayout: true }} /></div></section><section className="output-panel"><div className="output-heading"><div className="output-title"><SquareTerminal size={16} /><span>Output</span><span className="runtime-badge"><span className="pulse" /> Pyodide runtime</span></div><span className="output-hint">Runs {project.mainFile}</span></div><pre>{output}</pre></section></div>{isGraphicsOpen ? <aside className="graphics-panel"><div className="output-heading"><div className="output-title"><Sparkles size={16} /><span>Turtle graphics</span>{graphics.length > 0 && <span className="runtime-badge"><span className="pulse" /> gturtle window</span>}</div><button className="icon-button small" aria-label="Collapse graphics window" onClick={() => setIsGraphicsOpen(false)}><PanelRightClose size={15} /></button></div>{graphics.length > 0 ? <GraphicsWindow commands={graphics} /> : <p className="graphics-empty">Run a project that imports <code>gturtle</code> to see its drawing here.</p>}</aside> : <button className="graphics-collapsed-toggle" aria-label="Expand graphics window" onClick={() => setIsGraphicsOpen(true)}><PanelRightOpen size={16} /><span>Graphics</span></button>}</div></main>
      </div><footer className="statusbar"><span><span className="status-dot" /> Python 3.12 in browser</span><span>Autosave is off</span><span>glpython preview · built for learning</span></footer><div className="devbar"><span>Development tools</span><button onClick={resetLocalProject}><Trash2 size={13} /> Clear local project</button></div>
    </div>
  )
}

export default App
