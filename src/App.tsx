import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
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
import { applySubstitutions, buildAnnotationsUpTo, buildSubstitutionsUpTo, computeLineOffsets, computeOpenFramesUpTo, indexAstNodes, locateNodeRenderedRange, nodeRange, renderFrameSource, type AstNode, type OpenFrame, type TraceResult, type TraceStep } from './visualizer'
import './App.css'

// One highlighted (or plain) run of text within a single rendered line of a
// call-frame box - the plain-DOM equivalent of the inline decorations the
// main Monaco editor gets via deltaDecorations, since a box's content isn't
// a real Monaco model. A 'child' segment replaces its call site's own text
// entirely with a further-nested <CallFrameBox>, rendered inline exactly
// where that text sat (see childRanges in buildLineSegments below).
type LineSegment =
  | { kind: 'text'; text: string; className?: string }
  | { kind: 'child'; frame: OpenFrame }

function buildLineSegments(
  line: string,
  lineStart: number,
  highlights: Array<{ start: number; end: number }>,
  annotationHighlights: Array<{ start: number; end: number }>,
  childRanges: Array<{ start: number; end: number; frame: OpenFrame }>,
): LineSegment[] {
  const lineEnd = lineStart + line.length
  // A child's own call-site range replaces its text wholesale, so any
  // highlight/annotation mark that falls entirely inside one (e.g. the
  // substituted "2" inside "fact(2)", while that call itself is still open
  // and rendered as a nested box, not yet collapsed into a plain value) is
  // dropped here - otherwise it would be re-inserted as leftover text after
  // the child segment already consumed that whole range.
  const insideChild = (start: number, end: number) => childRanges.some((c) => start >= c.start && end <= c.end)
  const marks: Array<{ start: number; end: number; className?: string; frame?: OpenFrame }> = []
  for (const h of highlights) {
    if (insideChild(h.start, h.end)) continue
    const start = Math.max(h.start, lineStart)
    const end = Math.min(h.end, lineEnd)
    if (start < end) marks.push({ start: start - lineStart, end: end - lineStart, className: 'visual-substituted-value' })
  }
  for (const h of annotationHighlights) {
    if (insideChild(h.start, h.end)) continue
    const start = Math.max(h.start, lineStart)
    const end = Math.min(h.end, lineEnd)
    if (start < end) marks.push({ start: start - lineStart, end: end - lineStart, className: 'visual-loop-annotation' })
  }
  for (const c of childRanges) {
    const start = Math.max(c.start, lineStart)
    const end = Math.min(c.end, lineEnd)
    if (start < end) marks.push({ start: start - lineStart, end: end - lineStart, frame: c.frame })
  }
  marks.sort((a, b) => a.start - b.start)

  const segments: LineSegment[] = []
  let cursor = 0
  for (const mark of marks) {
    if (mark.start > cursor) segments.push({ kind: 'text', text: line.slice(cursor, mark.start) })
    if (mark.frame) segments.push({ kind: 'child', frame: mark.frame })
    else segments.push({ kind: 'text', text: line.slice(mark.start, mark.end), className: mark.className })
    cursor = mark.end
  }
  if (cursor < line.length || segments.length === 0) segments.push({ kind: 'text', text: line.slice(cursor) })
  return segments
}

type CallFrameBoxProps = {
  frame: OpenFrame
  openFrames: Map<number, OpenFrame>
  nodeIndexByFile: Map<string, Map<number, AstNode>>
  visualSources: Record<string, string>
  trace: TraceStep[]
  uptoStep: number
  currentStep: TraceStep | null
}

// Renders one open user-defined function call as a boxed frame anchored at
// its call site: a "def foo(a=3, b=4):" header (with bound-parameter values
// annotated, same mechanism as loop-variable annotations) followed by its
// body, with its own current-line highlight and its own substituted values -
// all scoped to this exact invocation via its unique frame id, so recursive
// calls to the same function never mix up each other's displayed state.
// Any further-nested open call inside this frame's body renders its own
// box recursively, right after the line that calls it.
function CallFrameBox({ frame, openFrames, nodeIndexByFile, visualSources, trace, uptoStep, currentStep }: CallFrameBoxProps) {
  const nodeIndex = nodeIndexByFile.get(frame.funcDefPath)
  const source = visualSources[frame.funcDefPath]
  const defNode = nodeIndex?.get(frame.funcDefNodeId)
  if (!nodeIndex || source === undefined || !defNode || defNode.line === undefined) return null

  const lineOffsets = computeLineOffsets(source)
  const defRange = nodeRange(defNode, lineOffsets)
  const substitutions = buildSubstitutionsUpTo(trace, uptoStep, frame.frameId).get(frame.funcDefPath)
  const annotations = new Map(buildAnnotationsUpTo(trace, uptoStep, frame.frameId).get(frame.funcDefPath) ?? [])
  for (const [nodeId, text] of frame.paramAnnotations) annotations.set(nodeId, text)

  const rendered = renderFrameSource(source, lineOffsets, nodeIndex, defNode, substitutions, annotations)
  if (!rendered || !defRange) return null

  const children = [...openFrames.values()].filter((f) => f.parentFrameId === frame.frameId)
  const isFrameActive = currentStep?.frameId === frame.frameId

  // Every further-nested open call inside this frame's own body, mapped to
  // where its own call-site text (e.g. "fact(2)") ends up within this
  // frame's *own* rendered text (already-clipped to defNode's span, exactly
  // matching rendered.text's coordinates) - so it can be spliced inline,
  // replacing that text, instead of appended as a separate row below it.
  const childRanges = children.flatMap((child) => {
    const anchorNode = child.anchorPath === frame.funcDefPath ? nodeIndex.get(child.anchorNodeId) : undefined
    if (!anchorNode) return []
    const range = locateNodeRenderedRange(source, lineOffsets, nodeIndex, substitutions, annotations, anchorNode)
    if (!range) return []
    return [{ start: range.start - defRange.start, end: range.end - defRange.start, frame: child }]
  })

  const lines = rendered.text.split('\n')
  let cursor = 0
  return (
    <div className="call-frame-box">
      <div className="call-frame-box-header">{frame.funcName}(...)</div>
      <div className="call-frame-box-body">
        {lines.map((line, index) => {
          const lineStart = cursor
          cursor += line.length + 1
          const absoluteLine = (defNode.line ?? 1) + index
          const isCurrentLine = isFrameActive && currentStep?.line === absoluteLine
          const segments = buildLineSegments(line, lineStart, rendered.highlights, rendered.annotationHighlights, childRanges)
          return (
            <div key={index}>
              <div className={`call-frame-line${isCurrentLine ? ' visual-current-line' : ''}`}>
                {segments.map((segment, segmentIndex) => segment.kind === 'child' ? (
                  <span key={segmentIndex} className="call-frame-zone">
                    <CallFrameBox
                      frame={segment.frame}
                      openFrames={openFrames}
                      nodeIndexByFile={nodeIndexByFile}
                      visualSources={visualSources}
                      trace={trace}
                      uptoStep={uptoStep}
                      currentStep={currentStep}
                    />
                  </span>
                ) : (
                  <span key={segmentIndex} className={segment.className}>{segment.text}</span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
  // One Monaco content widget + React root per top-level open call-frame
  // box currently anchored in the visible file, keyed by frame id, so boxes
  // can be added/updated/removed incrementally as the trace steps forward
  // instead of tearing everything down on every render. Content widgets
  // (rather than view zones) are what let a box render exactly at its call
  // site's position - inline, floating to the right of it - instead of as
  // a separate full-width row pushed below the line. Each entry's
  // ResizeObserver keeps frameSpacerChars (below) in sync as the box's own
  // content grows or shrinks.
  const boxWidgetsRef = useRef<Map<number, { widget: MonacoEditorNS.IContentWidget; root: Root; domNode: HTMLDivElement; observer: ResizeObserver; zoneId: string | null; zoneObj: MonacoEditorNS.IViewZone | null; zoneDomNode: HTMLDivElement }>>(new Map())
  // Decorations that hide each open call's own call-site text (its width is
  // preserved via visibility:hidden, so anything after it on the same line,
  // e.g. " * 2", keeps its original column) while its box floats over it.
  const callSiteHideDecorationsRef = useRef<string[]>([])
  // A box is almost always wider than the call text it floats over, so
  // trailing code on the same line (" * 2") would otherwise end up hidden
  // underneath it. Each open call's anchor node gets this many literal
  // space characters spliced into the *rendered text itself* right after
  // its own span (see applySubstitutions' `spacers` param), pushing any
  // trailing code on that line out to the right, clear of the floating
  // box - real characters, rather than a decoration, since Monaco's
  // injected-text (before/after) decorations don't render in this build.
  // Kept as state (not a ref) since changing it must re-run the
  // renderedActiveSource memo below to regenerate the editor's value.
  const [frameSpacerChars, setFrameSpacerChars] = useState<Map<number, number>>(new Map())
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
    return applySubstitutions(
      source,
      offsets,
      nodeIndex,
      substitutions.get(currentTraceStep.path),
      annotations.get(currentTraceStep.path),
      frameSpacerChars,
    )
  }, [currentTraceStep, visualSources, astIndexByFile, substitutions, annotations, frameSpacerChars])

  // Keep the open tab in sync with whichever file the trace is currently
  // executing in at module scope (e.g. an import's own top-level code) -
  // but never for code running inside a boxed function call, since that
  // now renders inline as a box at its call site instead of jumping the
  // view away to wherever it's defined.
  useEffect(() => {
    if (!currentTraceStep || currentTraceStep.frameId !== 0) return
    if (!project.files[currentTraceStep.path]) return
    setActiveFile(currentTraceStep.path)
    setOpenFiles((currentFiles) => currentFiles.includes(currentTraceStep.path) ? currentFiles : [...currentFiles, currentTraceStep.path])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTraceStep?.path, currentTraceStep?.frameId])

  // Highlight the currently executing line, and the substituted value spans,
  // directly in the Monaco editor whenever the visible step changes. Only
  // shown while execution is at module scope in this file - while inside a
  // boxed call, the current-line highlight instead appears inside that
  // call's own box (see CallFrameBox).
  useEffect(() => {
    const editorInstance = visualEditorRef.current
    const monaco = visualMonacoRef.current
    if (!isVisualizing || !editorInstance || !monaco || !currentTraceStep || !renderedActiveSource) {
      if (editorInstance) visualDecorationsRef.current = editorInstance.deltaDecorations(visualDecorationsRef.current, [])
      return
    }
    const model = editorInstance.getModel()
    if (!model) return
    const decorations: MonacoEditorNS.IModelDeltaDecoration[] = []
    if (currentTraceStep.frameId === 0 && currentTraceStep.path === activeFile) {
      decorations.push({
        range: new monaco.Range(currentTraceStep.line, 1, currentTraceStep.line, 1),
        options: { isWholeLine: true, className: 'visual-current-line', linesDecorationsClassName: 'visual-current-line-margin' },
      })
    }
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
  }, [isVisualizing, currentTraceStep, renderedActiveSource, activeFile])

  // Every call frame still open at the current step (module scope, frame 0,
  // is implicit and not included here) - drives both the boxed rendering
  // below and which frame's steps "count" for locals/highlighting above.
  const openFrames = useMemo(
    () => visualTrace ? computeOpenFramesUpTo(visualTrace.trace, currentTraceStep?.step ?? -1) : new Map<number, OpenFrame>(),
    [visualTrace, currentTraceStep],
  )

  // Renders every top-level open call (direct children of module scope)
  // anchored in the file currently shown in the visualizer editor as a
  // Monaco content widget positioned exactly at its call site - inline,
  // floating to the right of the (now hidden) call text, rather than as a
  // separate row pushed below the line - each one a <CallFrameBox>, which
  // recursively renders any further-nested open calls inside its own body.
  // Boxes are added/removed as frames open and close.
  useEffect(() => {
    const editorInstance = visualEditorRef.current
    const monaco = visualMonacoRef.current
    const widgets = boxWidgetsRef.current

    if (!isVisualizing || !editorInstance || !monaco) {
      if (editorInstance) {
        editorInstance.changeViewZones((accessor) => {
          for (const { zoneId } of widgets.values()) if (zoneId) accessor.removeZone(zoneId)
        })
      }
      for (const { root, widget, observer } of widgets.values()) { observer.disconnect(); root.unmount(); editorInstance?.removeContentWidget(widget) }
      widgets.clear()
      if (editorInstance) callSiteHideDecorationsRef.current = editorInstance.deltaDecorations(callSiteHideDecorationsRef.current, [])
      setFrameSpacerChars((current) => (current.size === 0 ? current : new Map()))
      return
    }

    const nodeIndex = astIndexByFile.get(activeFile)
    const topFrames = nodeIndex
      ? [...openFrames.values()].filter((frame) => frame.parentFrameId === 0 && frame.anchorPath === activeFile)
      : []

    const wantedIds = new Set(topFrames.map((frame) => frame.frameId))
    const removedZoneIds: string[] = []
    for (const [frameId, entry] of widgets) {
      if (!wantedIds.has(frameId)) {
        entry.observer.disconnect()
        entry.root.unmount()
        editorInstance.removeContentWidget(entry.widget)
        if (entry.zoneId) removedZoneIds.push(entry.zoneId)
        widgets.delete(frameId)
      }
    }
    if (removedZoneIds.length > 0) {
      editorInstance.changeViewZones((accessor) => { for (const zoneId of removedZoneIds) accessor.removeZone(zoneId) })
    }
    const wantedNodeIds = new Set(topFrames.map((frame) => frame.anchorNodeId))
    setFrameSpacerChars((current) => {
      let changed = false
      const next = new Map(current)
      for (const nodeId of next.keys()) if (!wantedNodeIds.has(nodeId)) { next.delete(nodeId); changed = true }
      return changed ? next : current
    })

    const hideDecorations: MonacoEditorNS.IModelDeltaDecoration[] = []
    for (const frame of topFrames) {
      const anchorNode = nodeIndex!.get(frame.anchorNodeId)
      if (!anchorNode || anchorNode.line === undefined || anchorNode.endLine === undefined || anchorNode.col === undefined || anchorNode.endCol === undefined) continue

      const startPos = { lineNumber: anchorNode.line, column: anchorNode.col + 1 }
      const endPos = { lineNumber: anchorNode.endLine, column: anchorNode.endCol + 1 }
      hideDecorations.push({
        range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
        options: { inlineClassName: 'call-site-hidden' },
      })

      let entry = widgets.get(frame.frameId)
      if (!entry) {
        const domNode = document.createElement('div')
        domNode.className = 'call-frame-zone'
        const root = createRoot(domNode)
        const widget: MonacoEditorNS.IContentWidget = {
          allowEditorOverflow: true,
          getId: () => `call-frame-widget-${frame.frameId}`,
          getDomNode: () => domNode,
          getPosition: () => ({
            position: { lineNumber: anchorNode.line!, column: anchorNode.col! + 1 },
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
          }),
        }
        editorInstance.addContentWidget(widget)
        // An empty view zone reserves vertical space right below the call
        // site's own line, so the following source line is pushed down and
        // stays visible beneath the box - rather than the box (which floats
        // independently of document flow, see the content widget above)
        // simply overlapping whatever line happens to sit right under it.
        const zoneDomNode = document.createElement('div')
        let zoneId: string | null = null
        let zoneObj: MonacoEditorNS.IViewZone | null = null
        editorInstance.changeViewZones((accessor) => {
          zoneObj = { afterLineNumber: endPos.lineNumber, heightInPx: 0, domNode: zoneDomNode }
          zoneId = accessor.addZone(zoneObj)
        })
        // Keeps the reserved horizontal spacer (real space characters
        // spliced into the rendered text right after the call, see
        // frameSpacerChars), the reserved vertical zone height, and the
        // widget's own on-screen position all in sync as the box's
        // rendered size changes every trace step.
        const observer = new ResizeObserver(() => {
          const boxWidth = domNode.offsetWidth
          const boxHeight = domNode.offsetHeight
          const startVisible = editorInstance.getScrolledVisiblePosition(startPos)
          const endVisible = editorInstance.getScrolledVisiblePosition(endPos)
          const callTextWidth = startVisible && endVisible ? endVisible.left - startVisible.left : 0
          const fontInfo = editorInstance.getOption(monaco.editor.EditorOption.fontInfo)
          const charWidth = fontInfo.spaceWidth || 8
          const charsNeeded = Math.max(0, Math.ceil((boxWidth - callTextWidth) / charWidth))
          setFrameSpacerChars((current) => (current.get(anchorNode.id) === charsNeeded ? current : new Map(current).set(anchorNode.id, charsNeeded)))
          const lineHeight = editorInstance.getOption(monaco.editor.EditorOption.lineHeight)
          const zoneHeight = Math.max(0, boxHeight - lineHeight)
          if (zoneObj && zoneObj.heightInPx !== zoneHeight) {
            zoneObj.heightInPx = zoneHeight
            editorInstance.changeViewZones((accessor) => { if (zoneId) accessor.layoutZone(zoneId) })
          }
          editorInstance.layoutContentWidget(widget)
        })
        observer.observe(domNode)
        entry = { widget, root, domNode, observer, zoneId, zoneObj, zoneDomNode }
        widgets.set(frame.frameId, entry)
      }
      entry.root.render(
        <CallFrameBox
          frame={frame}
          openFrames={openFrames}
          nodeIndexByFile={astIndexByFile}
          visualSources={visualSources}
          trace={visualTrace?.trace ?? []}
          uptoStep={currentTraceStep?.step ?? -1}
          currentStep={currentTraceStep}
        />,
      )
      // The box's rendered size can change every step (e.g. a nested box
      // opening inside it); ask Monaco to re-measure and reposition once
      // React has actually committed the update to the DOM.
      requestAnimationFrame(() => {
        const current = widgets.get(frame.frameId)
        if (current) editorInstance.layoutContentWidget(current.widget)
      })
    }
    callSiteHideDecorationsRef.current = editorInstance.deltaDecorations(callSiteHideDecorationsRef.current, hideDecorations)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisualizing, activeFile, openFrames, currentTraceStep, astIndexByFile, visualSources, visualTrace])

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
