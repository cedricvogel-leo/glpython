import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type { Monaco } from '@monaco-editor/react'
import { AlertTriangle, BookOpen, ChevronDown, Cloud, Download, FileCode2, FolderOpen, GraduationCap, Languages, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pause, Pencil, Play, Plus, RotateCcw, Save, Settings2, SkipBack, SkipForward, Sparkles, SquareTerminal, Terminal, Trash2, Upload, UserRound, Workflow, X } from 'lucide-react'
import { addProjectFile, deleteProjectFile, initialProject, renameProjectFile, updateProjectFile } from './project'
import type { ProjectFileKind } from './project'
import { initializeAuth, isAuthConfigured, signIn, signOut } from './auth'
import type { AccountInfo } from '@azure/msal-browser'
import { clearLocalProject, exportProjectZip, importProjectFolder, importProjectZip, loadLocalProject, saveLocalProject } from './projectStorage'
import { GraphicsWindow, type TurtleCommand } from './GraphicsWindow'
import { detectLocale, localeNames, saveLocale, translations, type Locale } from './i18n'
import { buildAnnotationsUpTo, buildExecutedLinesUpTo, buildLocalsUpTo, buildSubstitutionsUpTo, computeLineOffsets, computeOpenFramesUpTo, indexAstNodes, lineNumberAtOffset, locateNodeRenderedRange, nodeRange, renderFrameSource, type AstNode, type OpenFrame, type TraceResult, type TraceStep } from './visualizer'
import { tokenizePythonFragment } from './pyHighlight'
import './App.css'

const animationsStorageKey = 'glpython-visualizer-animations'

// One highlighted (or plain) run of text within a single rendered line of a
// call-frame box - the plain-DOM equivalent of the inline decorations the
// main Monaco editor gets via deltaDecorations, since a box's content isn't
// a real Monaco model. A 'child' segment replaces its call site's own text
// entirely with a further-nested <CallFrameBox>, rendered inline exactly
// where that text sat (see childRanges in buildLineSegments below).
type LineSegment =
  | { kind: 'text'; text: string; className?: string; annotationNodeId?: number }
  | { kind: 'child'; frame: OpenFrame }
  | { kind: 'group'; className: string; parts: Array<{ text: string; className?: string }> }

function buildLineSegments(
  line: string,
  lineStart: number,
  highlights: Array<{ start: number; end: number }>,
  // `nodeId`, when present, identifies exactly which annotated node (e.g.
  // a bound parameter name in a "def f(n=3):" header) this particular
  // annotation belongs to - carried through to a `data-annotation-node-id`
  // attribute below, so a connector arrow can anchor at one specific
  // annotation instead of just "the nearest annotation on this line".
  annotationHighlights: Array<{ start: number; end: number; nodeId?: number }>,
  childRanges: Array<{ start: number; end: number; frame: OpenFrame }>,
  nextStepRanges: Array<{ start: number; end: number }>,
): LineSegment[] {
  const lineEnd = lineStart + line.length
  // A child's own call-site range replaces its text wholesale, so any
  // highlight/annotation mark that falls entirely inside one (e.g. the
  // substituted "2" inside "fact(2)", while that call itself is still open
  // and rendered as a nested box, not yet collapsed into a plain value) is
  // dropped here - otherwise it would be re-inserted as leftover text after
  // the child segment already consumed that whole range.
  const insideChild = (start: number, end: number) => childRanges.some((c) => start >= c.start && end <= c.end)
  // `nextStep` is tracked as its own flag (rather than folded straight into
  // `className`) so that touching next-step marks can later be detected and
  // merged into one continuous box instead of leaving every mark to draw
  // its own outline - see the grouping pass below.
  const marks: Array<{ start: number; end: number; className?: string; frame?: OpenFrame; nextStep?: boolean; annotationNodeId?: number }> = []
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
    if (start < end) marks.push({ start: start - lineStart, end: end - lineStart, className: 'visual-loop-annotation', annotationNodeId: h.nodeId })
  }
  for (const c of childRanges) {
    const start = Math.max(c.start, lineStart)
    const end = Math.min(c.end, lineEnd)
    if (start < end) marks.push({ start: start - lineStart, end: end - lineStart, frame: c.frame })
  }
  // The exact AST node the *next* trace step (not yet applied, since
  // rendering is always clamped to uptoStep) is about to evaluate/execute -
  // a preview of what's about to change, distinct from the dimmer
  // already-executed/current-line treatment above. It can partially overlap
  // an already-substituted/annotated sub-range (e.g. "3 <= 1" where "3" was
  // substituted by an earlier step but the comparison itself is what's next)
  // - that overlapping portion is still part of the box, so instead of
  // carving it out we just add the next-step class alongside its existing
  // one. Child-frame boxes are the one exception: they render as their own
  // nested component with no text span to attach a class to, so they're
  // carved out (and the whole range is skipped if it sits entirely inside
  // one, via the insideChild check below).
  const existingMarks = marks.slice()
  for (const r of nextStepRanges) {
    if (insideChild(r.start, r.end)) continue
    const start = Math.max(r.start, lineStart) - lineStart
    const end = Math.min(r.end, lineEnd) - lineStart
    if (start >= end) continue
    let cursor = start
    for (const m of existingMarks) {
      const mStart = Math.max(m.start, cursor)
      const mEnd = Math.min(m.end, end)
      if (mStart >= mEnd) continue
      if (m.frame) {
        if (mStart > cursor) marks.push({ start: cursor, end: mStart, nextStep: true })
        cursor = Math.max(cursor, mEnd)
        continue
      }
      if (mStart > cursor) marks.push({ start: cursor, end: mStart, nextStep: true })
      m.nextStep = true
      cursor = Math.max(cursor, mEnd)
    }
    if (cursor < end) marks.push({ start: cursor, end, nextStep: true })
  }
  marks.sort((a, b) => a.start - b.start)

  // Touching next-step marks (e.g. an already-substituted "3" directly
  // followed by the plain "<= 1" that completes "3 <= 1") are merged into a
  // single group here so they render as one continuous highlighted box
  // instead of two dashed outlines meeting at a seam. Child-frame marks
  // never participate - they're their own nested component, not text.
  const grouped: Array<{ start: number; end: number; className?: string; frame?: OpenFrame; nextStep?: boolean; annotationNodeId?: number; parts?: Array<{ start: number; end: number; className?: string }> }> = []
  for (const mark of marks) {
    const prev = grouped[grouped.length - 1]
    if (mark.nextStep && !mark.frame && prev && prev.nextStep && !prev.frame && prev.end === mark.start) {
      if (!prev.parts) prev.parts = [{ start: prev.start, end: prev.end, className: prev.className }]
      prev.parts.push({ start: mark.start, end: mark.end, className: mark.className })
      prev.end = mark.end
      continue
    }
    grouped.push({ ...mark })
  }

  const segments: LineSegment[] = []
  let cursor2 = 0
  for (const mark of grouped) {
    if (mark.start > cursor2) segments.push({ kind: 'text', text: line.slice(cursor2, mark.start) })
    if (mark.frame) {
      segments.push({ kind: 'child', frame: mark.frame })
    } else if (mark.parts) {
      segments.push({ kind: 'group', className: 'visual-next-step', parts: mark.parts.map((p) => ({ text: line.slice(p.start, p.end), className: p.className })) })
    } else {
      const className = mark.nextStep ? (mark.className ? `${mark.className} visual-next-step` : 'visual-next-step') : mark.className
      segments.push({ kind: 'text', text: line.slice(mark.start, mark.end), className, annotationNodeId: mark.annotationNodeId })
    }
    cursor2 = mark.end
  }
  if (cursor2 < line.length || segments.length === 0) segments.push({ kind: 'text', text: line.slice(cursor2) })
  return segments
}

// A plain (un-substituted, un-annotated) run of source text is further
// split into syntax-colored runs here, using Monaco's own standalone Python
// tokenizer - so highlighting stays consistent with the real editor without
// a separate highlighting library. Substituted-value/annotation spans keep
// their own dedicated color instead (see the `className` branch below) and
// are never re-tokenized.
function TextSegment({ segment, monaco }: { segment: Extract<LineSegment, { kind: 'text' }>; monaco: Monaco | null }) {
  if (segment.className || !monaco || segment.text === '') return <span className={segment.className} data-annotation-node-id={segment.annotationNodeId}>{segment.text}</span>
  const runs = tokenizePythonFragment(monaco, segment.text)
  return <>{runs.map((run, index) => <span key={index} className={run.className}>{run.text}</span>)}</>
}

// Which source span a Frame renders: the outermost module/global scope
// (the whole file, no single AST node to clip to) or one open user-defined
// function call (clipped to its own "def foo(...):" node).
type FrameScope = { kind: 'module' } | { kind: 'call'; funcDefNodeId: number }

type FrameProps = {
  frameId: number
  path: string
  scope: FrameScope
  openFrames: Map<number, OpenFrame>
  nodeIndexByFile: Map<string, Map<number, AstNode>>
  visualSources: Record<string, string>
  trace: TraceStep[]
  uptoStep: number
  currentStep: TraceStep | null
  nextStep: TraceStep | null
  monaco: Monaco | null
  noLocalsLabel: string
  // A name about to be assigned/defined by `nextStep` (a plain `x = ...`
  // or `def f(...):`) that doesn't exist in this frame's locals yet - shown
  // one step early as a valueless placeholder row, so an arrow can point
  // from the upcoming value/def in the code to where it's about to land.
  declareTarget: { frameId: number; varName: string } | null
  // Parameter names of a user-defined function call about to start running
  // (`nextStep.kind === 'call-enter'`) that don't have values yet - shown
  // one step early as valueless placeholder rows in that about-to-open
  // callee frame (itself already spliced in early via `openFrames`, see
  // `framesForRender`/`nextStepPendingCall`), so an arrow can point from
  // each argument's value at the call site into its own placeholder row.
  pendingCallLocals: { frameId: number; paramNames: string[] } | null
}

// Renders one frame of execution - either the outermost module/global scope
// or one open user-defined function call anchored at its call site - as
// plain HTML driven directly by the trace/AST, instead of as Monaco overlay
// machinery. Every frame, however deeply nested, shares the exact same
// layout: its own source (with computed values substituted inline and its
// own current line highlighted) on the left, a thin divider, and its own
// variables panel on the right - all scoped to this exact invocation via
// its unique frame id, so recursive calls to the same function never mix up
// each other's displayed state. Any further-nested open call inside this
// frame's body renders its own Frame recursively, inline, right at its own
// call site - real DOM in normal flow, so surrounding text/lines reflow
// automatically.
function Frame({ frameId, path, scope, openFrames, nodeIndexByFile, visualSources, trace, uptoStep, currentStep, nextStep, monaco, noLocalsLabel, declareTarget, pendingCallLocals }: FrameProps) {
  const nodeIndex = nodeIndexByFile.get(path)
  const source = visualSources[path]
  if (!nodeIndex || source === undefined) return null

  const lineOffsets = computeLineOffsets(source)
  let clipRange: { start: number; end: number } | null = null
  if (scope.kind === 'call') {
    const defNode = nodeIndex.get(scope.funcDefNodeId)
    if (!defNode) return null
    clipRange = nodeRange(defNode, lineOffsets)
    if (!clipRange) return null
  }
  const startLine = lineNumberAtOffset(lineOffsets, clipRange?.start ?? 0)

  const substitutions = buildSubstitutionsUpTo(trace, uptoStep, frameId).get(path)
  const annotations = new Map(buildAnnotationsUpTo(trace, uptoStep, frameId).get(path) ?? [])
  const openFrame = frameId !== 0 ? openFrames.get(frameId) : undefined
  if (openFrame) for (const [nodeId, text] of openFrame.paramAnnotations) annotations.set(nodeId, text)

  const rendered = renderFrameSource(source, lineOffsets, nodeIndex, clipRange, substitutions, annotations)
  if (!rendered) return null

  const executedLines = buildExecutedLinesUpTo(trace, uptoStep, frameId, nodeIndexByFile).get(path)

  const children = [...openFrames.values()].filter((f) => f.parentFrameId === frameId)
  const isFrameActive = currentStep?.frameId === frameId
  const clipStart = clipRange?.start ?? 0

  // Every further-nested open call inside this frame's own body, mapped to
  // where its own call-site text (e.g. "fact(2)") ends up within this
  // frame's *own* rendered text (already-clipped to clipRange, exactly
  // matching rendered.text's coordinates) - so it can be spliced inline,
  // replacing that text, instead of appended as a separate row below it.
  // This includes a call whose own call hasn't actually started yet (the
  // one-step-early preview frame from `nextStepPendingCall`) - its call
  // site is swallowed just like any other child's, since the substituted
  // value it would have shown is instead rendered one step early inside
  // its own box's header (see nextStepPendingCall/paramAnnotations).
  const childRanges: Array<{ start: number; end: number; frame: OpenFrame }> = []
  for (const child of children) {
    const anchorNode = child.anchorPath === path ? nodeIndex.get(child.anchorNodeId) : undefined
    if (!anchorNode) continue
    const range = locateNodeRenderedRange(source, lineOffsets, nodeIndex, substitutions, annotations, anchorNode)
    if (!range) continue
    childRanges.push({ start: range.start - clipStart, end: range.end - clipStart, frame: child })
  }

  // The AST node the *next* trace step (uptoStep + 1) will touch, if that
  // step belongs to this exact frame - so the learner can see exactly the
  // span of code that's about to be mutated/replaced before clicking
  // "next" (e.g. just the one name about to be substituted, or the one
  // sub-expression about to be reduced to its result). A "call-enter" step
  // is special: its own frameId is the *new* callee frame (which doesn't
  // exist as an open Frame yet), while its nodeId/path describe the
  // call-site sitting in the *caller* frame instead - so it's matched
  // against parentFrameId.
  const nextStepFrameId = nextStep == null ? null : nextStep.kind === 'call-enter' ? (nextStep.parentFrameId ?? 0) : nextStep.frameId
  const nextStepRanges = nextStep !== null && nextStepFrameId === frameId && nextStep.path === path
    ? (() => {
        const nextNode = nodeIndex.get(nextStep.nodeId)
        if (!nextNode) return []
        const range = locateNodeRenderedRange(source, lineOffsets, nodeIndex, substitutions, annotations, nextNode, true)
        if (!range) return []
        return [{ start: range.start - clipStart, end: range.end - clipStart }]
      })()
    : []

  const isModule = scope.kind === 'module'
  const lines = rendered.text.split('\n')
  let cursor = 0
  const localEntries: Array<[string, string | null]> = Object.entries(buildLocalsUpTo(trace, uptoStep, frameId))
  if (declareTarget && declareTarget.frameId === frameId && !localEntries.some(([name]) => name === declareTarget.varName)) {
    localEntries.push([declareTarget.varName, null])
  }
  if (pendingCallLocals && pendingCallLocals.frameId === frameId) {
    for (const paramName of pendingCallLocals.paramNames) {
      if (!localEntries.some(([name]) => name === paramName)) localEntries.push([paramName, null])
    }
  }

  return (
    <div className={`frame-box${isModule ? ' frame-box--root' : ''}`} data-frame-id={frameId}>
      <div className="frame-code">
        {lines.map((line, index) => {
          const lineStart = cursor
          cursor += line.length + 1
          const absoluteLine = startLine + index
          const isCurrentLine = isFrameActive && currentStep?.line === absoluteLine
          const isExecutedLine = !isCurrentLine && executedLines?.has(absoluteLine) === true
          const lineStateClass = isCurrentLine ? ' visual-current-line' : isExecutedLine ? ' visual-executed-line' : ''
          const segments = buildLineSegments(line, lineStart, rendered.highlights, rendered.annotationHighlights, childRanges, nextStepRanges)
          const content = segments.map((segment, segmentIndex) => segment.kind === 'child' ? (
            <span key={segmentIndex} className="frame-child-zone">
              <Frame
                frameId={segment.frame.frameId}
                path={segment.frame.funcDefPath}
                scope={{ kind: 'call', funcDefNodeId: segment.frame.funcDefNodeId }}
                openFrames={openFrames}
                nodeIndexByFile={nodeIndexByFile}
                visualSources={visualSources}
                trace={trace}
                uptoStep={uptoStep}
                currentStep={currentStep}
                nextStep={nextStep}
                monaco={monaco}
                noLocalsLabel={noLocalsLabel}
                declareTarget={declareTarget}
                pendingCallLocals={pendingCallLocals}
              />
            </span>
          ) : segment.kind === 'group' ? (
            <span key={segmentIndex} className={segment.className}>
              {segment.parts.map((part, partIndex) => <span key={partIndex} className={part.className}>{part.text}</span>)}
            </span>
          ) : (
            <TextSegment key={segmentIndex} segment={segment} monaco={monaco} />
          ))
          // Only the outermost module frame shows a line-number gutter,
          // matching how Monaco only ever showed line numbers for the main
          // editor and never inside a nested box. The gutter number lives
          // in the same row as its line's content (rather than a separate
          // fixed-height column) so it still lines up correctly even when
          // an embedded nested frame makes that one logical line visually
          // taller than a plain line of text.
          if (isModule) {
            return (
              <div className={`frame-line-row${lineStateClass}`} key={index}>
                <span className="frame-gutter-num">{absoluteLine}</span>
                <div className={`frame-line${lineStateClass}`}>{content}</div>
              </div>
            )
          }
          return <div key={index} className={`frame-line${lineStateClass}`}>{content}</div>
        })}
      </div>
      <div className="frame-divider" />
      <div className="frame-vars">
        {localEntries.length > 0
          ? localEntries.map(([name, value]) => <div className="locals-row" key={name} data-name={name}><span className="locals-name">{name}</span><span className={`locals-value${value === null ? ' locals-value-pending' : ''}`} key={value ?? 'pending'}>{value === null ? '\u2026' : value}</span></div>)
          : <p className="frame-vars-empty">{noLocalsLabel}</p>}
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
  // -1 is the "before execution" state - nothing substituted, no output, no
  // locals, no current line highlighted - shown right after a trace loads
  // and reachable again via restart/stepping back from the first step.
  const [visualStepIndex, setVisualStepIndex] = useState(-1)
  const [isVisualPlaying, setIsVisualPlaying] = useState(false)
  // Whether step transitions (highlight/background fades, new frames and
  // local rows easing in, value-change flashes) are animated or applied
  // instantly - persisted like the locale choice, defaulting to on.
  const [animationsEnabled, setAnimationsEnabled] = useState<boolean>(() => localStorage.getItem(animationsStorageKey) !== 'false')
  const workerRef = useRef<Worker | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const languageMenuRef = useRef<HTMLDetailsElement | null>(null)
  const inputFieldRef = useRef<HTMLInputElement | null>(null)
  // Monaco's own namespace, obtained independent of whether any <Editor> is
  // currently mounted (it loads/caches lazily the first time any component
  // asks for it) - used only to run its standalone Python tokenizer for
  // syntax coloring in the plain-HTML visualizer view below; the real
  // Monaco <Editor> for normal editing is untouched by any of this.
  const monaco = useMonaco()
  // Scrollable container for the plain-HTML visualizer view, used to keep
  // the currently executing line in view as steps advance (see the
  // auto-scroll effect below) with ordinary DOM scrolling instead of
  // Monaco's view-zone/content-widget machinery.
  const visualizerScrollRef = useRef<HTMLDivElement | null>(null)
  const visualizerCanvasRef = useRef<HTMLDivElement | null>(null)
  const inputChannelRef = useRef<{ control: Int32Array; payload: Uint8Array } | null>(null)
  const selectedFile = project.files[activeFile] ?? project.files[project.mainFile]

  useEffect(() => {
    saveLocalProject(project)
  }, [project])

  useEffect(() => {
    saveLocale(locale)
  }, [locale])

  useEffect(() => {
    localStorage.setItem(animationsStorageKey, String(animationsEnabled))
  }, [animationsEnabled])

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
        setVisualStepIndex(-1)
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
    setVisualStepIndex(-1)
  }
  const saveFile = () => { setIsSaved(true); setOutput(t.savedOutput(selectedFile.path)) }

  const isVisualizing = visualTrace !== null
  const visualTraceSteps = visualTrace?.trace ?? []
  // Lower bound of -1 is the "before execution" state; upper bound is the
  // last recorded step (or -1 itself if no steps were recorded at all).
  const clampedStepIndex = Math.min(Math.max(visualStepIndex, -1), Math.max(0, visualTraceSteps.length - 1))
  const currentTraceStep = visualTraceSteps[clampedStepIndex] ?? null
  // The step that will run next if the learner clicks "next" - previewed
  // via highlighting its AST span, including before any step has run yet
  // (clampedStepIndex === -1), so the very first statement is shown too.
  const nextTraceStep = visualTraceSteps[clampedStepIndex + 1] ?? null

  const astIndexByFile = useMemo(() => {
    const map = new Map<string, ReturnType<typeof indexAstNodes>>()
    if (visualTrace) for (const [path, file] of Object.entries(visualTrace.ast)) map.set(path, indexAstNodes(file))
    return map
  }, [visualTrace])

  // When the pending next step is a bare variable read (e.g. "n" about to
  // be looked up and substituted by its current value), note which frame
  // and name it reads from - so an arrow can be drawn from that variable's
  // row in the locals panel to the highlighted "n" in the code, making the
  // upcoming substitution concrete instead of implicit.
  const nextStepVarSource = useMemo(() => {
    if (!nextTraceStep) return null
    const node = astIndexByFile.get(nextTraceStep.path)?.get(nextTraceStep.nodeId)
    if (!node || node.type !== 'Name') return null
    const frameId = nextTraceStep.kind === 'call-enter' ? (nextTraceStep.parentFrameId ?? 0) : nextTraceStep.frameId
    return { frameId, varName: node.summary }
  }, [nextTraceStep, astIndexByFile])

  // When the pending next step is a plain "x = ..." assignment or a
  // "def f(...):" that's about to bind a name this frame doesn't have yet,
  // note which frame and name it's about to create - so that name can be
  // shown one step early as a valueless placeholder row (see Frame's
  // `declareTarget` prop), with an arrow drawn from the upcoming
  // value/def in the code into that placeholder instead of the other way
  // around.
  const nextStepDeclareTarget = useMemo(() => {
    if (!nextTraceStep || nextTraceStep.kind !== 'exec') return null
    const node = astIndexByFile.get(nextTraceStep.path)?.get(nextTraceStep.nodeId)
    if (!node) return null
    let varName: string | null = null
    if (node.type === 'FunctionDef') {
      varName = node.summary || null
    } else if (node.type === 'Assign') {
      const targets = node.fields.targets
      const onlyTarget = Array.isArray(targets) && targets.length === 1 ? targets[0] : null
      if (onlyTarget && typeof onlyTarget === 'object' && (onlyTarget as AstNode).type === 'Name') varName = (onlyTarget as AstNode).summary
    }
    if (!varName) return null
    const frameId = nextTraceStep.frameId
    const currentLocals = buildLocalsUpTo(visualTraceSteps, currentTraceStep?.step ?? -1, frameId)
    if (varName in currentLocals) return null
    return { frameId, varName }
  }, [nextTraceStep, astIndexByFile, visualTraceSteps, currentTraceStep])

  // When the pending next step is a "call-enter" (a user-defined function
  // about to start running), synthesize that callee frame's OpenFrame
  // entry one step early so it renders inline at its call site exactly
  // like any other open frame (see `framesForRender` below, merged into
  // the `openFrames` map handed down to <Frame>) - since no trace steps
  // exist yet for that frame id, every locals/substitution lookup keyed
  // off it naturally comes back empty, so it renders "for free" as a
  // totally fresh, not-yet-started call - except its header already shows
  // each bound parameter's real value one step early via paramAnnotations
  // (exactly like a real open frame does, see the Frame component's
  // `annotations` map), which is also where the connector arrows below
  // originate from. Also keeps the raw argSources list around (now just
  // each bound parameter's name, in parameter-def order), used to seed
  // this frame's own parameters as valueless placeholder rows
  // (`pendingCallLocals`).
  const nextStepPendingCall = useMemo(() => {
    if (!nextTraceStep || nextTraceStep.kind !== 'call-enter') return null
    if (nextTraceStep.funcDefNodeId === null || nextTraceStep.funcDefPath === null) return null
    const openFrame: OpenFrame = {
      frameId: nextTraceStep.frameId,
      parentFrameId: nextTraceStep.parentFrameId ?? 0,
      funcName: nextTraceStep.func,
      anchorPath: nextTraceStep.path,
      anchorNodeId: nextTraceStep.nodeId,
      funcDefPath: nextTraceStep.funcDefPath,
      funcDefNodeId: nextTraceStep.funcDefNodeId,
      paramAnnotations: nextTraceStep.paramAnnotations,
    }
    return { openFrame, argSources: nextTraceStep.argSources }
  }, [nextTraceStep])

  // When the pending next step is a "call-pending" (a user-defined call
  // whose callee and arguments are already resolved - the call site reads
  // e.g. "fact(2)" - but whose frame hasn't opened yet, see
  // "call-pending"/`lookupName` on TraceStep), note which frame and name
  // the callee itself is bound under - so an arrow can be drawn from that
  // name's own row in the locals panel (showing "function", see
  // `_glpython_describe_for_locals_panel`) into the highlighted call
  // expression, representing the upcoming function lookup. Deliberately
  // distinct from `nextStepPendingCall` above: that one still only fires
  // for the step *after* this one (its own `call-enter` step), so the
  // callee's frame box correctly stays closed for the one extra step this
  // adds.
  const nextStepFuncLookup = useMemo(() => {
    if (!nextTraceStep || nextTraceStep.kind !== 'call-pending' || nextTraceStep.lookupName === null || nextTraceStep.lookupFrameId === null) return null
    return { frameId: nextTraceStep.lookupFrameId, varName: nextTraceStep.lookupName }
  }, [nextTraceStep])

  // When the pending next step closes a callee frame (its own "eval" step
  // for the Call node, once the callee has fully returned - see
  // `closesFrameId` on TraceStep), note which frame is about to collapse
  // and the value it's collapsing into - so an arrow can be drawn, and
  // later a flying copy of that value animated, from inside the
  // about-to-close frame-box out to wherever its call expression sits in
  // the parent (the box's own position, since it's rendered inline right
  // there and about to be replaced by this plain value once it closes).
  const nextStepReturnFlight = useMemo(() => {
    if (!nextTraceStep || nextTraceStep.closesFrameId === null || nextTraceStep.valueText === null) return null
    return { frameId: nextTraceStep.closesFrameId, value: nextTraceStep.valueText }
  }, [nextTraceStep])

  // SVG paths (in the coordinate space of .visualizer-canvas) for the
  // arrows above, measured straight from the rendered DOM once per
  // relevant change - there's no other reliable way to know where either
  // endpoint ends up on screen, since both sit inside reflowing,
  // variable-width text. Usually at most one path is active at once, but a
  // function call with several arguments needs one simultaneous arrow per
  // argument, hence an array rather than a single optional path. Each
  // entry also carries the text of its "known" endpoint (where the arrow
  // starts), so that if this very arrow disappears on the next step - i.e.
  // its value just got substituted - a short-lived copy of that text can
  // fly along the same curve into its destination (see `flights` below).
  // `kind` lets the layout effect treat a connector differently depending
  // on what it represents: 'funcLookup' connectors never fly their value as
  // a flight (the about-to-open frame-box flies/grows from that spot
  // instead - see the box-origin logic below), and 'arg' connectors (the
  // per-parameter arrows into a freshly-opened callee frame) aren't even
  // measured until that frame-box's own move+grow animation has finished
  // (see `growListenerRef` below) - measuring any earlier would read back
  // the box's still-shrunken, mid-flight geometry. `x1`/`y1` are the
  // connector's source anchor point (canvas-relative), kept around so the
  // box-origin logic can reuse it without re-measuring the DOM.
  type Connector = { d: string; value: string; kind: 'var' | 'funcLookup' | 'arg' | 'return'; x1: number; y1: number }
  const [connectorPaths, setConnectorPaths] = useState<Connector[]>([])

  // Short-lived "value flying along the arrow it just consumed" ghosts,
  // spawned in the layout effect below whenever stepping forward makes a
  // previously-shown connector disappear. Purely decorative (and disabled
  // along with every other animation via `animationsEnabled`), so each one
  // just removes itself again once its CSS motion-path animation ends.
  const [flights, setFlights] = useState<{ id: number; d: string; value: string }[]>([])
  const flightIdRef = useRef(0)
  const prevConnectorsRef = useRef<Connector[]>([])
  // Tracks the one 'animationend' listener (if any) currently waiting on a
  // freshly-opened callee frame-box's grow animation, so a later effect run
  // (e.g. the user stepping again before it fires) can detach it instead of
  // leaving it to fire against a now-stale step.
  const growListenerRef = useRef<{ el: HTMLElement; handler: (event: AnimationEvent) => void } | null>(null)
  const prevStepIndexRef = useRef(clampedStepIndex)
  const animationsEnabledRef = useRef(animationsEnabled)
  animationsEnabledRef.current = animationsEnabled


  // Keep the open tab in sync with whichever file the trace is currently
  // executing in at module scope (e.g. an import's own top-level code) -
  // but never for code running inside a call frame, since that now renders
  // inline at its own call site instead of jumping the view away to
  // wherever it's defined.
  useEffect(() => {
    if (!currentTraceStep || currentTraceStep.frameId !== 0) return
    if (!project.files[currentTraceStep.path]) return
    setActiveFile(currentTraceStep.path)
    setOpenFiles((currentFiles) => currentFiles.includes(currentTraceStep.path) ? currentFiles : [...currentFiles, currentTraceStep.path])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTraceStep?.path, currentTraceStep?.frameId])

  // Every call frame still open at the current step (module scope, frame 0,
  // is implicit and not included here) - drives both the Frame rendering
  // below and which frame's steps "count" for locals/highlighting above.
  const openFrames = useMemo(
    () => visualTrace ? computeOpenFramesUpTo(visualTrace.trace, currentTraceStep?.step ?? -1) : new Map<number, OpenFrame>(),
    [visualTrace, currentTraceStep],
  )

  // `openFrames` plus, when applicable, the one synthetic "about to open"
  // callee frame from `nextStepPendingCall` above - this is what actually
  // gets handed down to <Frame>, so that pending frame renders inline at
  // its call site one step early, exactly like any other already-open call.
  const framesForRender = useMemo(() => {
    if (!nextStepPendingCall) return openFrames
    const merged = new Map(openFrames)
    merged.set(nextStepPendingCall.openFrame.frameId, nextStepPendingCall.openFrame)
    return merged
  }, [openFrames, nextStepPendingCall])

  const pendingCallLocals = useMemo(() => nextStepPendingCall
    ? { frameId: nextStepPendingCall.openFrame.frameId, paramNames: nextStepPendingCall.argSources }
    : null, [nextStepPendingCall])

  useLayoutEffect(() => {
    const canvas = visualizerCanvasRef.current
    if (!canvas) { setConnectorPaths([]); return }
    const canvasRect = canvas.getBoundingClientRect()

    // One bezier path (in the given canvas-relative coordinate space)
    // between two already-rendered DOM elements, always exiting the source
    // from whichever side faces the target and entering the target from
    // whichever side faces the source - so the curve never has to double
    // back through either endpoint's own text, regardless of which visual
    // direction this particular arrow happens to flow in (locals -> code,
    // code -> locals, or code -> code). `rect` is taken as a parameter
    // (rather than closing over a single canvas rect measured once) so the
    // deferred per-argument measurement below can re-measure the canvas
    // fresh once the callee frame-box's grow animation has actually
    // finished, instead of reusing a rect captured while it was still mid-flight.
    const pathBetween = (sourceEl: Element, targetEl: Element, kind: Connector['kind'], rect: DOMRect, valueOverride?: string): Connector => {
      const sourceRect = sourceEl.getBoundingClientRect()
      const targetRect = targetEl.getBoundingClientRect()
      const y1 = sourceRect.top - rect.top + sourceRect.height / 2
      const y2 = targetRect.top - rect.top + targetRect.height / 2
      const dir = targetRect.left + targetRect.right >= sourceRect.left + sourceRect.right ? 1 : -1
      const x1 = (dir === 1 ? sourceRect.right : sourceRect.left) - rect.left
      const x2 = (dir === 1 ? targetRect.left : targetRect.right) - rect.left
      const dx = Math.max(Math.abs(x2 - x1) * 0.5, 40)
      // Strip a leading "=" from parameter-annotation sources (e.g. the
      // "=3" shown next to "n" in "def fact(n=3):") so the flying copy
      // reads as a plain value, matching what lands in the locals row.
      // `valueOverride` lets a caller supply the authoritative text itself
      // instead (used for the return-flight connector below, since its
      // source element is a whole "return ..." line rather than a span
      // containing just the value - and a base-case literal return like
      // "return 1" has no dedicated value span to read from at all).
      const value = valueOverride ?? (sourceEl.textContent?.trim() ?? '').replace(/^=/, '')
      return { d: `M ${x1} ${y1} C ${x1 + dx * dir} ${y1}, ${x2 - dx * dir} ${y2}, ${x2} ${y2}`, value, kind, x1, y1 }
    }

    const paths: Connector[] = []

    // "nextStepVarSource" means a value already known in the locals panel
    // is about to flow out into the code (arrow: locals -> code);
    // "nextStepDeclareTarget" is the opposite - a value already sitting in
    // the code is about to flow into a freshly-declared, still-valueless
    // locals row (arrow: code -> locals). Only one of the two can ever be
    // set at once, since they key off disjoint AST node types.
    const varAnchor = nextStepVarSource ?? nextStepDeclareTarget
    if (varAnchor) {
      const varEl = canvas.querySelector(
        `.frame-box[data-frame-id="${varAnchor.frameId}"] > .frame-vars > .locals-row[data-name="${CSS.escape(varAnchor.varName)}"] .locals-value`,
      )
      const codeEl = canvas.querySelector('.visual-next-step')
      if (varEl && codeEl) paths.push(pathBetween(nextStepVarSource ? varEl : codeEl, nextStepVarSource ? codeEl : varEl, 'var', canvasRect))
    }

    // "nextStepFuncLookup": the about-to-be-called function's own row in
    // whichever frame defines it (showing "function") flowing into the
    // fully-substituted call expression itself (e.g. "fact(2)") - the same
    // locals -> code direction as `nextStepVarSource` above, just keyed off
    // a different step kind, so it's always disjoint from both `varAnchor`
    // cases and can safely add its own path alongside them.
    if (nextStepFuncLookup) {
      const funcEl = canvas.querySelector(
        `.frame-box[data-frame-id="${nextStepFuncLookup.frameId}"] > .frame-vars > .locals-row[data-name="${CSS.escape(nextStepFuncLookup.varName)}"] .locals-value`,
      )
      const codeEl = canvas.querySelector('.visual-next-step')
      if (funcEl && codeEl) paths.push(pathBetween(funcEl, codeEl, 'funcLookup', canvasRect))
    }

    // "nextStepReturnFlight": the about-to-close callee frame-box's own
    // current (return) line flowing out into the box's own header line -
    // the box renders inline right at its call site, so its own position
    // is exactly where the plain substituted value will land once it
    // collapses this step. Can't target `.visual-next-step` here like the
    // other connectors above: the call expression's own AST range is still
    // entirely swallowed by this still-open child box (see the
    // `insideChild` carve-out in `buildLineSegments`), so there's no bare
    // text span to point at yet. Sourcing from the whole return line
    // (rather than hunting for a `.visual-substituted-value` span inside
    // it) and overriding the flown text with this step's own `valueText`
    // also sidesteps the base-case literal-return edge case, where the
    // returned value is plain, un-substituted source text with no
    // dedicated span of its own (e.g. `return 1`).
    if (nextStepReturnFlight) {
      const boxEl = canvas.querySelector(`.frame-box[data-frame-id="${nextStepReturnFlight.frameId}"]`)
      const lineEl = boxEl?.querySelector('.visual-current-line')
      const headerEl = boxEl?.querySelector(':scope > .frame-code > .frame-line:first-child')
      if (lineEl && (headerEl ?? boxEl)) paths.push(pathBetween(lineEl, headerEl ?? boxEl!, 'return', canvasRect, nextStepReturnFlight.value))
    }

    // One arrow per bound parameter of the about-to-open callee frame:
    // from that parameter's own annotation in the callee's own header
    // (e.g. the "3" in "def fact(n=3):", identified by its AST node id via
    // data-annotation-node-id - matched to this paramName via the callee's
    // own paramAnnotations, since argSources is just a plain name list)
    // into that parameter's placeholder row in the locals panel below it.
    // Takes `rect` as a parameter (see `pathBetween` above) rather than
    // closing over `canvasRect`, since it also gets called later, after a
    // fresh re-measurement, from the deferred grow-animation handler below.
    const buildArgConnectors = (rect: DOMRect): Connector[] => {
      if (!nextStepPendingCall) return []
      const calleeFrameId = nextStepPendingCall.openFrame.frameId
      const result: Connector[] = []
      for (const paramName of nextStepPendingCall.argSources) {
        const annotation = nextStepPendingCall.openFrame.paramAnnotations.find(([, , name]) => name === paramName)
        if (!annotation) continue
        const [nodeId] = annotation
        const argEl = canvas.querySelector(`.frame-box[data-frame-id="${calleeFrameId}"] [data-annotation-node-id="${nodeId}"]`)
        const paramEl = canvas.querySelector(
          `.frame-box[data-frame-id="${calleeFrameId}"] > .frame-vars > .locals-row[data-name="${CSS.escape(paramName)}"] .locals-value`,
        )
        if (argEl && paramEl) result.push(pathBetween(argEl, paramEl, 'arg', rect))
      }
      return result
    }

    // Detach any previously-scheduled grow-animation listener before
    // (possibly) scheduling a new one below - otherwise a listener left over
    // from an earlier step the user has since moved away from could fire
    // later and append a stale arrow for a frame that's no longer pending.
    if (growListenerRef.current) {
      growListenerRef.current.el.removeEventListener('animationend', growListenerRef.current.handler)
      growListenerRef.current.el.removeEventListener('animationcancel', growListenerRef.current.handler)
      growListenerRef.current = null
    }

    if (nextStepPendingCall) {
      const calleeFrameId = nextStepPendingCall.openFrame.frameId

      // Rather than fading/growing in place, the freshly-opened callee
      // frame-box flies in from wherever its own "function" row was sitting
      // in its defining scope a moment ago (the very spot the now-gone
      // 'funcLookup' connector pointed out of) - so stash that point as a
      // translate offset, consumed by the `visual-frame-grow` keyframe in
      // App.css, which animates it back down to (0, 0) while scaling up.
      // Frames with no such predecessor (shouldn't normally happen, but
      // kept as a safe fallback) just scale up in place instead.
      const boxEl = canvas.querySelector(`.frame-box[data-frame-id="${calleeFrameId}"]`)
      if (boxEl instanceof HTMLElement) {
        const origin = prevConnectorsRef.current.find((connector) => connector.kind === 'funcLookup')
        if (origin) {
          const boxRect = boxEl.getBoundingClientRect()
          const cx = boxRect.left - canvasRect.left + boxRect.width / 2
          const cy = boxRect.top - canvasRect.top + boxRect.height / 2
          boxEl.style.setProperty('--grow-dx', `${origin.x1 - cx}px`)
          boxEl.style.setProperty('--grow-dy', `${origin.y1 - cy}px`)
        } else {
          boxEl.style.removeProperty('--grow-dx')
          boxEl.style.removeProperty('--grow-dy')
        }

        if (animationsEnabledRef.current) {
          // This effect runs synchronously before paint, i.e. before the
          // box's own CSS grow animation has had any chance to run - so
          // every element inside it, including the per-argument targets
          // above, would currently measure at the box's shrunken, mid-flight
          // size/position rather than its real, settled one. Measuring now
          // would bake those wrong coordinates straight into the arrow, so
          // instead wait for the box's grow animation to actually finish and
          // only then measure/add the per-argument arrows. Also handles
          // 'animationcancel' (e.g. the user unchecks "animate steps" while
          // the box is still mid-grow, which abruptly removes the
          // animation instead of ever firing 'animationend') the same way,
          // since by that point the box is already at its real final size.
          const handleGrowEnd = (event: AnimationEvent) => {
            if (event.target !== boxEl || event.animationName !== 'visual-frame-grow') return
            boxEl.removeEventListener('animationend', handleGrowEnd)
            boxEl.removeEventListener('animationcancel', handleGrowEnd)
            if (growListenerRef.current?.handler === handleGrowEnd) growListenerRef.current = null
            const argConnectors = buildArgConnectors(canvas.getBoundingClientRect())
            if (argConnectors.length === 0) return
            setConnectorPaths((current) => [...current, ...argConnectors])
            prevConnectorsRef.current = [...prevConnectorsRef.current, ...argConnectors]
          }
          boxEl.addEventListener('animationend', handleGrowEnd)
          boxEl.addEventListener('animationcancel', handleGrowEnd)
          growListenerRef.current = { el: boxEl, handler: handleGrowEnd }
        } else {
          // No animation is going to play at all, so the box is already at
          // its real, final size/position right now - measure immediately.
          paths.push(...buildArgConnectors(canvasRect))
        }
      }
    }

    // Stepping forward past a step that was showing a connector turns that
    // connector's "known" endpoint into the real, now-substituted value -
    // exactly the transition the arrow was foreshadowing - so fly a copy of
    // its text along the very same curve it just traced, into whichever
    // destination it was pointing at. Stepping backward (or sideways, via
    // the scrubber) undoes rather than performs a substitution, so it never
    // spawns flights; it just drops the stale connectors like before. The
    // one exception is a 'funcLookup' connector disappearing because its
    // callee frame-box just opened - that transition is shown by the box
    // itself flying/growing in from that spot (see above) instead of a
    // flying copy of the word "function".
    const steppedForward = clampedStepIndex > prevStepIndexRef.current
    const flightSources = prevConnectorsRef.current.filter((connector) => connector.kind !== 'funcLookup')
    if (steppedForward && animationsEnabledRef.current && flightSources.length > 0) {
      const newFlights = flightSources.map((connector) => ({ id: flightIdRef.current++, ...connector }))
      setFlights((current) => [...current, ...newFlights])
      const ids = newFlights.map((f) => f.id)
      // Matches the `.visual-flight-move` / `.visual-flight-arrow-fade` animation duration in App.css.
      window.setTimeout(() => setFlights((current) => current.filter((f) => !ids.includes(f.id))), 600)
    }
    prevConnectorsRef.current = paths
    prevStepIndexRef.current = clampedStepIndex

    setConnectorPaths(paths)
  }, [nextStepVarSource, nextStepDeclareTarget, nextStepPendingCall, nextStepFuncLookup, nextStepReturnFlight, currentTraceStep, openFrames, clampedStepIndex])

  // Keeps the currently executing line in view as steps advance, with
  // ordinary DOM scrolling - directly replacing the old Monaco
  // view-zone/content-widget machinery, whose geometry bookkeeping across
  // four separate systems was the root cause of the previous scrolling
  // bugs. 'nearest' avoids jumping the view around on every single step,
  // only scrolling when the active line would otherwise leave the
  // viewport (e.g. stepping into/out of a deeply nested call).
  useEffect(() => {
    if (!isVisualizing) return
    const container = visualizerScrollRef.current
    const activeLine = container?.querySelector('.visual-current-line')
    activeLine?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [isVisualizing, currentTraceStep])

  // Auto-play: advance one step every 500ms while playing, stopping at the
  // end of the trace.
  useEffect(() => {
    if (!isVisualPlaying || !visualTrace) return
    if (clampedStepIndex >= visualTraceSteps.length - 1) { setIsVisualPlaying(false); return }
    const timer = window.setTimeout(() => setVisualStepIndex((index) => Math.min(index + 1, visualTraceSteps.length - 1)), 500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisualPlaying, clampedStepIndex, visualTrace])

  const visualStepBack = () => { setIsVisualPlaying(false); setVisualStepIndex((index) => Math.max(-1, index - 1)) }
  const visualStepForward = () => { setIsVisualPlaying(false); setVisualStepIndex((index) => Math.min(visualTraceSteps.length - 1, index + 1)) }
  const visualRestart = () => { setIsVisualPlaying(false); setVisualStepIndex(-1) }
  const visualTogglePlay = () => setIsVisualPlaying((playing) => !playing)

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
        <main className="main-area">{authErrorMessage && <div className="auth-notice" role="status">{authErrorMessage}</div>}<div className="main-split"><div className="editor-column"><div className="editor-header"><div className="breadcrumbs"><span>{project.name}</span><span>/</span><strong>{selectedFile.path}</strong>{!isSaved && <span className="unsaved">{t.unsaved}</span>}</div><div className="editor-actions">{isVisualizing ? <button className="secondary-button" onClick={exitVisualizer}><X size={15} /> {t.exitVisualizer}</button> : <><button className="secondary-button" onClick={() => setOutput(t.readyOutput)}><RotateCcw size={15} /> {t.resetOutput}</button><button className="secondary-button" onClick={saveFile}><Save size={15} /> {t.save}</button><button className="secondary-button" onClick={runVisualize} disabled={isRunning || isVisualizerLoading}><Workflow size={15} /> {isVisualizerLoading ? t.visualizing : t.visualize}</button><button className="run-button" onClick={runCode} disabled={isRunning}><Play size={15} fill="currentColor" /> {isRunning ? t.running : t.runProject}</button></>}</div></div>{isVisualizing && <div className="visualizer-bar"><div className="visualizer-title"><Workflow size={15} /><span>{t.visualizerTitle}</span></div>{visualTraceSteps.length > 0 ? <><span className="visualizer-step-count">{clampedStepIndex === -1 ? t.visualizerBeforeStart : t.visualizerStepOf(clampedStepIndex + 1, visualTraceSteps.length)}</span><input className="visualizer-scrubber" type="range" min={-1} max={Math.max(0, visualTraceSteps.length - 1)} value={clampedStepIndex} onChange={(event) => { setIsVisualPlaying(false); setVisualStepIndex(Number(event.target.value)) }} /><div className="visualizer-controls"><button className="icon-button small" aria-label={t.visualizerRestart} onClick={visualRestart}><RotateCcw size={15} /></button><button className="icon-button small" aria-label={t.visualizerPrevStep} onClick={visualStepBack} disabled={clampedStepIndex === -1}><SkipBack size={15} /></button><button className="icon-button small" aria-label={isVisualPlaying ? t.visualizerPause : t.visualizerPlay} onClick={visualTogglePlay}>{isVisualPlaying ? <Pause size={15} /> : <Play size={15} />}</button><button className="icon-button small" aria-label={t.visualizerNextStep} onClick={visualStepForward} disabled={clampedStepIndex >= visualTraceSteps.length - 1}><SkipForward size={15} /></button></div></> : <span className="visualizer-step-count">{t.visualizerNoSteps}</span>}<label className="visualizer-animate-toggle"><input type="checkbox" checked={animationsEnabled} onChange={(event) => setAnimationsEnabled(event.target.checked)} /> {t.visualizerAnimate}</label></div>}{isVisualizing && (visualTrace?.truncated || visualTrace?.error) && <div className="visualizer-warning"><AlertTriangle size={14} />{visualTrace?.error ? t.visualizerError(visualTrace.error) : t.visualizerTruncated}</div>}<section className="editor-panel"><div className="editor-tabs">{openFiles.map((path) => { const file = project.files[path]; return <button className={`editor-tab ${activeFile === path ? 'active' : ''}`} key={path} onClick={() => setActiveFile(path)}><span className={`tab-file-icon ${file.kind === 'python' ? 'python' : 'notes'}`}>{file.kind === 'python' ? <FileCode2 size={14} /> : <BookOpen size={14} />}</span><span>{file.path}</span><span className="tab-close" role="button" aria-label={t.closeFile(file.path)} onClick={(event) => { event.stopPropagation(); closeFile(path) }}><X size={13} /></span></button> })}</div><div className="editor-wrap">{isVisualizing ? <div className={`visualizer-view${animationsEnabled ? ' visualizer-animated' : ''}`} ref={visualizerScrollRef}><div className="visualizer-canvas" ref={visualizerCanvasRef}><Frame frameId={0} path={activeFile} scope={{ kind: 'module' }} openFrames={framesForRender} nodeIndexByFile={astIndexByFile} visualSources={visualSources} trace={visualTrace?.trace ?? []} uptoStep={currentTraceStep?.step ?? -1} currentStep={currentTraceStep} nextStep={nextTraceStep} monaco={monaco} noLocalsLabel={t.visualizerNoLocals} declareTarget={nextStepDeclareTarget} pendingCallLocals={pendingCallLocals} />{(connectorPaths.length > 0 || flights.length > 0) && <svg className="visualizer-connectors"><defs><marker id="visualizer-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>{connectorPaths.map((connector, index) => <path key={index} d={connector.d} markerEnd="url(#visualizer-arrowhead)" />)}{animationsEnabled && flights.map((flight) => <path key={`flight-${flight.id}`} className="visual-flight-arrow" d={flight.d} markerEnd="url(#visualizer-arrowhead)" />)}</svg>}{animationsEnabled && flights.length > 0 && <div className="visualizer-flights">{flights.map((flight) => <span key={flight.id} className="visual-flight-value" style={{ offsetPath: `path('${flight.d}')` }}>{flight.value}</span>)}</div>}</div></div> : <Editor key="normal-editor" height="100%" language={selectedFile.kind === 'python' ? 'python' : 'markdown'} theme="vs-dark" value={selectedFile.code} onChange={updateCode} options={{ minimap: { enabled: false }, fontSize: 15, lineHeight: 24, padding: { top: 22 }, fontFamily: "'JetBrains Mono', monospace", scrollBeyondLastLine: false, smoothScrolling: true, automaticLayout: true, tabSize: 4, insertSpaces: true, detectIndentation: false }} />}</div></section><section className="output-panel"><div className="output-heading"><div className="output-title"><SquareTerminal size={16} /><span>{t.output}</span><span className="runtime-badge"><span className="pulse" /> {t.pyodideRuntime}</span></div><span className="output-hint">{t.runsFile(project.mainFile)}</span></div><pre>{isVisualizing ? (visualTrace?.output.slice(0, currentTraceStep?.stdoutLen ?? 0) || t.noOutput) : output}</pre></section></div>{isGraphicsOpen ? <aside className="graphics-panel"><div className="output-heading"><div className="output-title"><Sparkles size={16} /><span>{t.turtleGraphics}</span>{graphics.length > 0 && <span className="runtime-badge"><span className="pulse" /> {t.gturtleWindow}</span>}</div><button className="icon-button small" aria-label={t.collapseGraphics} onClick={() => setIsGraphicsOpen(false)}><PanelRightClose size={15} /></button></div>{(isVisualizing ? (visualTrace?.graphics.slice(0, currentTraceStep?.graphicsLen ?? 0) as TurtleCommand[] ?? []) : graphics).length > 0 ? <GraphicsWindow commands={isVisualizing ? (visualTrace?.graphics.slice(0, currentTraceStep?.graphicsLen ?? 0) as TurtleCommand[] ?? []) : graphics} /> : <p className="graphics-empty">{t.graphicsEmptyBefore} <code>gturtle</code> {t.graphicsEmptyAfter}</p>}</aside> : <button className="graphics-collapsed-toggle" aria-label={t.expandGraphics} onClick={() => setIsGraphicsOpen(true)}><PanelRightOpen size={16} /><span>{t.graphicsCollapsedLabel}</span></button>}</div></main>

      </div><footer className="statusbar"><span><span className="status-dot" /> {t.statusRuntime}</span><span>{t.autosaveOff}</span><span>{t.footerTagline}</span></footer><div className="devbar"><span>{t.devTools}</span><button onClick={resetLocalProject}><Trash2 size={13} /> {t.clearLocalProject}</button></div>
      {inputRequest !== null && <div className="input-dialog-backdrop" role="presentation" onClick={() => respondToInput(true)}><form className="input-dialog" role="dialog" aria-modal="true" aria-label={t.inputDialogTitle} onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); respondToInput(false) }}><div className="input-dialog-heading"><Terminal size={16} /><span>{t.inputDialogTitle}</span></div><p className="input-dialog-prompt">{inputRequest || t.inputDialogFallbackPrompt}</p><input ref={inputFieldRef} className="input-dialog-field" type="text" value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder={t.inputPlaceholder} /><div className="input-dialog-actions"><button type="button" className="secondary-button" onClick={() => respondToInput(true)}>{t.inputCancel}</button><button type="submit" className="run-button">{t.inputSubmit}</button></div></form></div>}
    </div>
  )
}

export default App
