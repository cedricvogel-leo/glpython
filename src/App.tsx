import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type { Monaco, OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditorNS } from 'monaco-editor'
import { AlertTriangle, BookOpen, ChevronDown, Cloud, Download, FileCode2, FolderOpen, GraduationCap, Languages, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pause, Pencil, Play, Plus, RotateCcw, Save, Settings2, SkipBack, SkipForward, Sparkles, SquareTerminal, Terminal, Trash2, Upload, UserRound, Workflow, X } from 'lucide-react'
import { addProjectFile, deleteProjectFile, initialProject, renameProjectFile, updateProjectFile } from './project'
import type { ProjectFileKind } from './project'
import { initializeAuth, isAuthConfigured, signIn, signOut } from './auth'
import type { AccountInfo } from '@azure/msal-browser'
import { clearLocalProject, exportProjectZip, importProjectFolder, importProjectZip, loadLocalProject, saveLocalProject } from './projectStorage'
import { GraphicsWindow, type TurtleCommand } from './GraphicsWindow'
import { detectLocale, localeNames, saveLocale, translations, type Locale } from './i18n'
import { applySubstitutions, buildAnnotationsUpTo, buildSubstitutionsUpTo, computeLineOffsets, indexAstNodes, type TraceResult } from './visualizer'
import './App.css'

function App() {
  const [locale, setLocale] = useState<Locale>(() => detectLocale())
  const t = translations[locale]
  const [project, setProject] = useState(() => loadLocalProject(initialProject))
  const [activeFile, setActiveFile] = useState(() => loadLocalProject(initialProject).mainFile)
  const [openFiles, setOpenFiles] = useState(() => [loadLocalProject(initialProject).mainFile])
  const [output, setOutput] = useState(() => translations[detectLocale()].readyOutput)
  const [graphics, setGraphics] = useState<TurtleCommand[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [isSaved, setIsSaved] = useState(true)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [authErrorKey, setAuthErrorKey] = useState<'' | 'init' | 'config' | 'cancelled'>('')
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isGraphicsOpen, setIsGraphicsOpen] = useState(true)
  const [inputRequest, setInputRequest] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isVisualizerLoading, setIsVisualizerLoading] = useState(false)
  const [visualTrace, setVisualTrace] = useState<TraceResult | null>(null)
  const [visualSources, setVisualSources] = useState<Record<string, string>>({})
  const [visualStepIndex, setVisualStepIndex] = useState(0)
  const [isVisualPlaying, setIsVisualPlaying] = useState(false)
  const workerRef = useRef<Worker | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const languageMenuRef = useRef<HTMLDetailsElement | null>(null)
  const inputFieldRef = useRef<HTMLInputElement | null>(null)
  const visualEditorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null)
  const visualMonacoRef = useRef<Monaco | null>(null)
  const visualDecorationsRef = useRef<string[]>([])
  const inputChannelRef = useRef<{ control: Int32Array; payload: Uint8Array } | null>(null)
  const selectedFile = project.files[activeFile] ?? project.files[project.mainFile]

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

  const handleAuthClick = async () => {
    setAuthErrorKey('')
    if (!isAuthConfigured) {
      setAuthErrorKey('config')
      return
    }
    try {
      if (account) {
        await signOut()
        setAccount(null)
      } else {
        await signIn()
      }
    } catch {
      setAuthErrorKey('cancelled')
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

  const renameProject = () => {
    const requestedName = window.prompt(t.promptRenameProject, project.name)?.trim()
    if (!requestedName || requestedName === project.name) return
    setProject((currentProject) => ({ ...currentProject, name: requestedName }))
    setIsSaved(false)
  }

  const addFile = () => {
    const requestedPath = window.prompt(t.promptFileName, t.promptDefaultFileName)?.trim()
    if (!requestedPath || project.files[requestedPath]) return
    const kind: ProjectFileKind = requestedPath.endsWith('.py') ? 'python' : 'text'
    const newFile = { path: requestedPath, label: requestedPath.replace(/\.[^/.]+$/, ''), kind, code: kind === 'python' ? '# Start writing Python here\n' : '' }
    setProject((currentProject) => addProjectFile(currentProject, newFile))
    openFile(requestedPath)
    setIsSaved(false)
  }

  const renameFile = (path: string) => {
    const requestedPath = window.prompt(t.promptRenameFile, path)?.trim()
    if (!requestedPath || requestedPath === path || project.files[requestedPath]) return
    setProject((currentProject) => renameProjectFile(currentProject, path, requestedPath))
    setOpenFiles((currentFiles) => currentFiles.map((openPath) => openPath === path ? requestedPath : openPath))
    if (activeFile === path) setActiveFile(requestedPath)
    setIsSaved(false)
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
    setIsSaved(false)
  }

  const localeRef = useRef(locale)
  localeRef.current = locale

  useEffect(() => {
    const worker = new Worker('/pyodide-worker.js')
    worker.onmessage = (event: MessageEvent<{ type: string; output?: string; graphics?: TurtleCommand[]; prompt?: string } & Partial<TraceResult>>) => {
      const currentTranslation = translations[localeRef.current]
      if (event.data.type === 'ready') setOutput(currentTranslation.pythonReadyOutput)
      if (event.data.type === 'result' || event.data.type === 'error') { setOutput(event.data.output || currentTranslation.noOutput); setGraphics(event.data.graphics ?? []); setIsRunning(false) }
      if (event.data.type === 'input_request') { setInputValue(''); setInputRequest(event.data.prompt ?? '') }
      if (event.data.type === 'trace-result') {
        setIsVisualizerLoading(false)
        setVisualTrace(event.data as TraceResult)
        setVisualStepIndex(0)
        setIsVisualPlaying(false)
      }
    }
    if (typeof SharedArrayBuffer !== 'undefined') {
      const buffer = new SharedArrayBuffer(8 + 4096)
      const control = new Int32Array(buffer, 0, 2)
      const payload = new Uint8Array(buffer, 8)
      inputChannelRef.current = { control, payload }
      worker.postMessage({ type: 'init-input-channel', buffer })
    }
    workerRef.current = worker
    return () => worker.terminate()
  }, [])

  useEffect(() => {
    if (inputRequest !== null) inputFieldRef.current?.focus()
  }, [inputRequest])

  const respondToInput = (cancelled: boolean) => {
    const channel = inputChannelRef.current
    if (channel) {
      const encoded = cancelled ? new Uint8Array(0) : new TextEncoder().encode(inputValue).slice(0, channel.payload.length)
      channel.payload.fill(0)
      channel.payload.set(encoded)
      Atomics.store(channel.control, 1, encoded.length)
      Atomics.store(channel.control, 0, cancelled ? 3 : 2)
      Atomics.notify(channel.control, 0)
    }
    setInputRequest(null)
    setInputValue('')
  }

  const updateCode = (code: string | undefined) => {
    setProject((currentProject) => updateProjectFile(currentProject, activeFile, code ?? ''))
    setIsSaved(false)
  }
  const runCode = () => {
    if (!workerRef.current) return
    setIsRunning(true); setOutput(t.runningOutput(project.mainFile))
    workerRef.current.postMessage({
      type: 'run',
      project: {
        mainFile: project.mainFile,
        files: Object.fromEntries(Object.entries(project.files).map(([path, file]) => [path, file.code])),
      },
    })
  }
  const runVisualize = () => {
    if (!workerRef.current) return
    setIsVisualizerLoading(true)
    setIsVisualPlaying(false)
    const sources = Object.fromEntries(Object.entries(project.files).map(([path, file]) => [path, file.code]))
    setVisualSources(sources)
    workerRef.current.postMessage({
      type: 'run-visual',
      project: { mainFile: project.mainFile, files: sources },
    })
  }
  const exitVisualizer = () => {
    setVisualTrace(null)
    setIsVisualPlaying(false)
    setVisualStepIndex(0)
  }
  const saveFile = () => { setIsSaved(true); setOutput(t.savedOutput(selectedFile.path)) }

  const isVisualizing = visualTrace !== null
  const visualTraceSteps = visualTrace?.trace ?? []
  const clampedStepIndex = Math.min(visualStepIndex, Math.max(0, visualTraceSteps.length - 1))
  const currentTraceStep = visualTraceSteps[clampedStepIndex] ?? null

  const astIndexByFile = useMemo(() => {
    const map = new Map<string, ReturnType<typeof indexAstNodes>>()
    if (visualTrace) for (const [path, file] of Object.entries(visualTrace.ast)) map.set(path, indexAstNodes(file))
    return map
  }, [visualTrace])

  const substitutions = useMemo(
    () => visualTrace ? buildSubstitutionsUpTo(visualTrace.trace, currentTraceStep?.step ?? -1) : new Map(),
    [visualTrace, currentTraceStep],
  )

  const annotations = useMemo(
    () => visualTrace ? buildAnnotationsUpTo(visualTrace.trace, currentTraceStep?.step ?? -1) : new Map(),
    [visualTrace, currentTraceStep],
  )

  const renderedActiveSource = useMemo(() => {
    if (!currentTraceStep) return null
    const source = visualSources[currentTraceStep.path]
    if (source === undefined) return null
    const offsets = computeLineOffsets(source)
    const nodeIndex = astIndexByFile.get(currentTraceStep.path) ?? new Map()
    return applySubstitutions(source, offsets, nodeIndex, substitutions.get(currentTraceStep.path), annotations.get(currentTraceStep.path))
  }, [currentTraceStep, visualSources, astIndexByFile, substitutions, annotations])

  // Keep the open tab in sync with whichever file the trace is currently
  // executing in (e.g. stepping into an imported project file).
  useEffect(() => {
    if (!currentTraceStep) return
    if (!project.files[currentTraceStep.path]) return
    setActiveFile(currentTraceStep.path)
    setOpenFiles((currentFiles) => currentFiles.includes(currentTraceStep.path) ? currentFiles : [...currentFiles, currentTraceStep.path])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTraceStep?.path])

  // Highlight the currently executing line, and the substituted value spans,
  // directly in the Monaco editor whenever the visible step changes.
  useEffect(() => {
    const editorInstance = visualEditorRef.current
    const monaco = visualMonacoRef.current
    if (!isVisualizing || !editorInstance || !monaco || !currentTraceStep || !renderedActiveSource) {
      if (editorInstance) visualDecorationsRef.current = editorInstance.deltaDecorations(visualDecorationsRef.current, [])
      return
    }
    const model = editorInstance.getModel()
    if (!model) return
    const decorations: MonacoEditorNS.IModelDeltaDecoration[] = [
      {
        range: new monaco.Range(currentTraceStep.line, 1, currentTraceStep.line, 1),
        options: { isWholeLine: true, className: 'visual-current-line', linesDecorationsClassName: 'visual-current-line-margin' },
      },
    ]
    for (const { start, end } of renderedActiveSource.highlights) {
      const startPos = model.getPositionAt(start)
      const endPos = model.getPositionAt(end)
      decorations.push({
        range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
        options: { inlineClassName: 'visual-substituted-value' },
      })
    }
    for (const { start, end } of renderedActiveSource.annotationHighlights) {
      const startPos = model.getPositionAt(start)
      const endPos = model.getPositionAt(end)
      decorations.push({
        range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
        options: { inlineClassName: 'visual-loop-annotation' },
      })
    }
    visualDecorationsRef.current = editorInstance.deltaDecorations(visualDecorationsRef.current, decorations)
  }, [isVisualizing, currentTraceStep, renderedActiveSource])

  // Auto-play: advance one step every 500ms while playing, stopping at the
  // end of the trace.
  useEffect(() => {
    if (!isVisualPlaying || !visualTrace) return
    if (clampedStepIndex >= visualTraceSteps.length - 1) { setIsVisualPlaying(false); return }
    const timer = window.setTimeout(() => setVisualStepIndex((index) => Math.min(index + 1, visualTraceSteps.length - 1)), 500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisualPlaying, clampedStepIndex, visualTrace])

  const visualStepBack = () => { setIsVisualPlaying(false); setVisualStepIndex((index) => Math.max(0, index - 1)) }
  const visualStepForward = () => { setIsVisualPlaying(false); setVisualStepIndex((index) => Math.min(visualTraceSteps.length - 1, index + 1)) }
  const visualRestart = () => { setIsVisualPlaying(false); setVisualStepIndex(0) }
  const visualTogglePlay = () => setIsVisualPlaying((playing) => !playing)
  const handleVisualEditorMount: OnMount = (editorInstance, monaco) => {
    visualEditorRef.current = editorInstance
    visualMonacoRef.current = monaco
  }

  const downloadProject = async () => {
    const blob = await exportProjectZip(project)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${project.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.zip`
    link.click()
    URL.revokeObjectURL(url)
    setOutput(t.downloadedOutput(project.name))
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
      setOutput(t.openedFolderOutput(importedProject.name))
    } catch {
      setOutput(t.folderNotOpened)
    }
  }

  const openZip = async (file: File) => {
    try {
      const importedProject = await importProjectZip(file, project)
      setProject(importedProject)
      setActiveFile(importedProject.mainFile)
      setOpenFiles([importedProject.mainFile])
      setIsSaved(true)
      setOutput(t.openedZipOutput(importedProject.name))
    } catch {
      setOutput(t.zipNotOpened)
    }
  }


  const resetLocalProject = () => {
    if (!window.confirm(t.confirmClearProject)) return
    clearLocalProject()
    window.location.reload()
  }

  const authErrorMessage = authErrorKey === 'init' ? t.authInitError : authErrorKey === 'config' ? t.authConfigError : authErrorKey === 'cancelled' ? t.authCancelledError : ''

  return (
    <div className="app-shell">
      <header className="topbar"><div className="brand"><button className="icon-button" aria-label={isSidebarOpen ? t.collapseSidebar : t.expandSidebar} onClick={() => setIsSidebarOpen((open) => !open)}>{isSidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button><div className="brand-mark"><Sparkles size={17} /></div><span>glpython</span><span className="brand-divider">/</span><span className="workspace-name">{t.workspaceName}</span></div><div className="topbar-actions"><details className="project-menu"><summary className="workspace-button"><FolderOpen size={15} /><span>{t.openProject}</span><ChevronDown size={13} /></summary><div className="project-menu-options"><button onClick={() => { void openFolder() }}><FolderOpen size={14} /> {t.openFolder}</button><button onClick={() => zipInputRef.current?.click()}><Upload size={14} /> {t.openProject}</button></div></details><button className="workspace-button" onClick={downloadProject}><Download size={15} /><span>{t.downloadProject}</span></button><input ref={zipInputRef} className="hidden-input" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openZip(file); event.target.value = '' }} /><button className={`cloud-status ${account ? 'connected' : ''}`} onClick={handleAuthClick}><Cloud size={16} /><span>{account ? t.microsoftConnected : t.signInWithMicrosoft}</span></button><button className="icon-button" aria-label={isGraphicsOpen ? t.collapseGraphics : t.expandGraphics} onClick={() => setIsGraphicsOpen((open) => !open)}>{isGraphicsOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}</button><details className="project-menu language-menu" ref={languageMenuRef}><summary className="workspace-button" aria-label={t.language}><Languages size={15} /><span>{localeNames[locale]}</span><ChevronDown size={13} /></summary><div className="project-menu-options">{(Object.keys(localeNames) as Locale[]).map((code) => <button key={code} className={code === locale ? 'active' : ''} onClick={() => selectLocale(code)}>{localeNames[code]}</button>)}</div></details><button className="icon-button" aria-label={t.settings}><Settings2 size={18} /></button><div className="avatar" title={account?.username ?? t.notSignedIn}><UserRound size={16} /></div></div></header>
      <div className="workspace">
        {isSidebarOpen && <aside className="sidebar"><div className="course-heading"><div><span className="eyebrow">{t.courseCategory}</span><h1>{project.name}</h1></div><button className="icon-button small" aria-label={t.renameProject} title={t.renameProject} onClick={renameProject}><Pencil size={16} /></button></div><div className="progress-row"><span>{t.lessonProgress}</span><strong>12%</strong></div><div className="progress-track"><span /></div><nav className="lesson-nav"><div className="nav-section"><span className="nav-label">{t.projectFiles}</span><button className="icon-button small" aria-label={t.addFile} onClick={addFile}><Plus size={16} /></button></div>{Object.values(project.files).map((file) => <div className={`file-item ${activeFile === file.path ? 'active' : ''}`} key={file.path}><button className="file-open-button" onClick={() => openFile(file.path)}><span className={`file-icon ${file.kind === 'python' ? 'python' : 'notes'}`}>{file.kind === 'python' ? <FileCode2 size={15} /> : <BookOpen size={15} />}</span><span>{file.label}</span>{openFiles.includes(file.path) && <span className="open-file-mark" />}</button><span className="file-actions"><button className="file-action" aria-label={t.renameFile(file.path)} onClick={() => renameFile(file.path)}><Pencil size={13} /></button><button className="file-action danger" aria-label={t.deleteFile(file.path)} onClick={() => deleteFile(file.path)}><Trash2 size={13} /></button></span></div>)}</nav><div className="sidebar-bottom"><div className="teacher-note"><GraduationCap size={18} /><div><strong>{t.teacherNoteTitle}</strong><span>{t.teacherNoteBody}</span></div></div><button className="help-link"><SquareTerminal size={16} /> {t.pythonReference}</button></div></aside>}
        <main className="main-area">{authErrorMessage && <div className="auth-notice" role="status">{authErrorMessage}</div>}<div className="main-split"><div className="editor-column"><div className="editor-header"><div className="breadcrumbs"><span>{project.name}</span><span>/</span><strong>{selectedFile.path}</strong>{!isSaved && <span className="unsaved">{t.unsaved}</span>}</div><div className="editor-actions">{isVisualizing ? <button className="secondary-button" onClick={exitVisualizer}><X size={15} /> {t.exitVisualizer}</button> : <><button className="secondary-button" onClick={() => setOutput(t.readyOutput)}><RotateCcw size={15} /> {t.resetOutput}</button><button className="secondary-button" onClick={saveFile}><Save size={15} /> {t.save}</button><button className="secondary-button" onClick={runVisualize} disabled={isRunning || isVisualizerLoading}><Workflow size={15} /> {isVisualizerLoading ? t.visualizing : t.visualize}</button><button className="run-button" onClick={runCode} disabled={isRunning}><Play size={15} fill="currentColor" /> {isRunning ? t.running : t.runProject}</button></>}</div></div>{isVisualizing && <div className="visualizer-bar"><div className="visualizer-title"><Workflow size={15} /><span>{t.visualizerTitle}</span></div>{visualTraceSteps.length > 0 ? <><span className="visualizer-step-count">{t.visualizerStepOf(clampedStepIndex + 1, visualTraceSteps.length)}</span><input className="visualizer-scrubber" type="range" min={0} max={Math.max(0, visualTraceSteps.length - 1)} value={clampedStepIndex} onChange={(event) => { setIsVisualPlaying(false); setVisualStepIndex(Number(event.target.value)) }} /><div className="visualizer-controls"><button className="icon-button small" aria-label={t.visualizerRestart} onClick={visualRestart}><RotateCcw size={15} /></button><button className="icon-button small" aria-label={t.visualizerPrevStep} onClick={visualStepBack} disabled={clampedStepIndex === 0}><SkipBack size={15} /></button><button className="icon-button small" aria-label={isVisualPlaying ? t.visualizerPause : t.visualizerPlay} onClick={visualTogglePlay}>{isVisualPlaying ? <Pause size={15} /> : <Play size={15} />}</button><button className="icon-button small" aria-label={t.visualizerNextStep} onClick={visualStepForward} disabled={clampedStepIndex >= visualTraceSteps.length - 1}><SkipForward size={15} /></button></div></> : <span className="visualizer-step-count">{t.visualizerNoSteps}</span>}</div>}{isVisualizing && (visualTrace?.truncated || visualTrace?.error) && <div className="visualizer-warning"><AlertTriangle size={14} />{visualTrace?.error ? t.visualizerError(visualTrace.error) : t.visualizerTruncated}</div>}<section className="editor-panel"><div className="editor-tabs">{openFiles.map((path) => { const file = project.files[path]; return <button className={`editor-tab ${activeFile === path ? 'active' : ''}`} key={path} onClick={() => setActiveFile(path)}><span className={`tab-file-icon ${file.kind === 'python' ? 'python' : 'notes'}`}>{file.kind === 'python' ? <FileCode2 size={14} /> : <BookOpen size={14} />}</span><span>{file.path}</span><span className="tab-close" role="button" aria-label={t.closeFile(file.path)} onClick={(event) => { event.stopPropagation(); closeFile(path) }}><X size={13} /></span></button> })}</div><div className="editor-wrap">{isVisualizing ? <Editor key="visualizer-editor" height="100%" language={selectedFile.kind === 'python' ? 'python' : 'markdown'} theme="vs-dark" value={currentTraceStep?.path === activeFile && renderedActiveSource ? renderedActiveSource.text : (visualSources[activeFile] ?? selectedFile.code)} onMount={handleVisualEditorMount} options={{ minimap: { enabled: false }, fontSize: 15, lineHeight: 24, padding: { top: 22 }, fontFamily: "'JetBrains Mono', monospace", scrollBeyondLastLine: false, smoothScrolling: true, automaticLayout: true, readOnly: true }} /> : <Editor key="normal-editor" height="100%" language={selectedFile.kind === 'python' ? 'python' : 'markdown'} theme="vs-dark" value={selectedFile.code} onChange={updateCode} options={{ minimap: { enabled: false }, fontSize: 15, lineHeight: 24, padding: { top: 22 }, fontFamily: "'JetBrains Mono', monospace", scrollBeyondLastLine: false, smoothScrolling: true, automaticLayout: true }} />}</div></section>{isVisualizing ? <section className="output-panel visualizer-locals"><div className="output-heading"><div className="output-title"><SquareTerminal size={16} /><span>{t.visualizerLocals}</span></div><span className="output-hint">{currentTraceStep?.func ?? ''}</span></div>{currentTraceStep && Object.keys(currentTraceStep.locals).length > 0 ? <div className="locals-grid">{Object.entries(currentTraceStep.locals).map(([name, value]) => <div className="locals-row" key={name}><span className="locals-name">{name}</span><span className="locals-value">{value}</span></div>)}</div> : <p className="graphics-empty">{t.visualizerNoLocals}</p>}</section> : <section className="output-panel"><div className="output-heading"><div className="output-title"><SquareTerminal size={16} /><span>{t.output}</span><span className="runtime-badge"><span className="pulse" /> {t.pyodideRuntime}</span></div><span className="output-hint">{t.runsFile(project.mainFile)}</span></div><pre>{output}</pre></section>}</div>{isGraphicsOpen ? <aside className="graphics-panel"><div className="output-heading"><div className="output-title"><Sparkles size={16} /><span>{t.turtleGraphics}</span>{graphics.length > 0 && <span className="runtime-badge"><span className="pulse" /> {t.gturtleWindow}</span>}</div><button className="icon-button small" aria-label={t.collapseGraphics} onClick={() => setIsGraphicsOpen(false)}><PanelRightClose size={15} /></button></div>{(isVisualizing ? (visualTrace?.graphics.slice(0, currentTraceStep?.graphicsLen ?? 0) as TurtleCommand[] ?? []) : graphics).length > 0 ? <GraphicsWindow commands={isVisualizing ? (visualTrace?.graphics.slice(0, currentTraceStep?.graphicsLen ?? 0) as TurtleCommand[] ?? []) : graphics} /> : <p className="graphics-empty">{t.graphicsEmptyBefore} <code>gturtle</code> {t.graphicsEmptyAfter}</p>}</aside> : <button className="graphics-collapsed-toggle" aria-label={t.expandGraphics} onClick={() => setIsGraphicsOpen(true)}><PanelRightOpen size={16} /><span>{t.graphicsCollapsedLabel}</span></button>}</div></main>

      </div><footer className="statusbar"><span><span className="status-dot" /> {t.statusRuntime}</span><span>{t.autosaveOff}</span><span>{t.footerTagline}</span></footer><div className="devbar"><span>{t.devTools}</span><button onClick={resetLocalProject}><Trash2 size={13} /> {t.clearLocalProject}</button></div>
      {inputRequest !== null && <div className="input-dialog-backdrop" role="presentation" onClick={() => respondToInput(true)}><form className="input-dialog" role="dialog" aria-modal="true" aria-label={t.inputDialogTitle} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); respondToInput(false) }}><div className="input-dialog-heading"><Terminal size={16} /><span>{t.inputDialogTitle}</span></div><p className="input-dialog-prompt">{inputRequest || t.inputDialogFallbackPrompt}</p><input ref={inputFieldRef} className="input-dialog-field" type="text" value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder={t.inputPlaceholder} /><div className="input-dialog-actions"><button type="button" className="secondary-button" onClick={() => respondToInput(true)}>{t.inputCancel}</button><button type="submit" className="run-button">{t.inputSubmit}</button></div></form></div>}
    </div>
  )
}

export default App
